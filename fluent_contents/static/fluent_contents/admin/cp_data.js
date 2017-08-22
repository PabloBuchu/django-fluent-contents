/**
 * This file deals with the lowest data layer / data administration of the backend editor.
 *
 * It tracks the 'ContentItem' metadata of the plugins.
 */
var cp_data = {};


(function($)
{
  // Fast UUID generator, based on MIT licensed
  // http://stackoverflow.com/questions/105034/how-to-create-a-guid-uuid-in-javascript/21963136#21963136
  var hex = []; for (var i=0; i<256; i++) { hex[i] = (i<16?'0':'')+(i).toString(16); }
  function generateUUID() {
    var d0 = Math.random()*0x100000000>>>0;
    var d1 = Math.random()*0x100000000>>>0;
    var d2 = Math.random()*0x100000000>>>0;
    var d3 = Math.random()*0x100000000>>>0;
    return hex[d0&0xff]+hex[d0>>8&0xff]+hex[d0>>16&0xff]+hex[d0>>24&0xff]+'-'+
      hex[d1&0xff]+hex[d1>>8&0xff]+'-'+hex[d1>>16&0x0f|0x40]+hex[d1>>24&0xff]+'-'+
      hex[d2&0x3f|0x80]+hex[d2>>8&0xff]+'-'+hex[d2>>16&0xff]+hex[d2>>24&0xff]+
      hex[d3&0xff]+hex[d3>>8&0xff]+hex[d3>>16&0xff]+hex[d3>>24&0xff];
  }


  // Stored data
  cp_data.placeholders = {};  // the formset items by placeholder;

  // Public data (also for debugging)
  cp_data.placeholder_metadata = null;  // [ { slot: 'main', title: 'Main', role: 'm', domnode: 'someid' }, { slot: 'sidebar', ...} ]
  cp_data.initial_placeholders = null;
  cp_data.contentitem_metadata = null;


  // Public initialisation functions
  cp_data.set_placeholders = function(data)
  {
    cp_data.placeholder_metadata = data;
    if( ! cp_data.initial_placeholders )
    {
      cp_data.initial_placeholders = data;
    }
    else
    {
      // Allow move icon to be shown/hidden.
      if( cp_data.placeholder_metadata.length == 1 )
        $("body").addClass('cp-single-placeholder');
      else
        $("body").removeClass('cp-single-placeholder');
    }
  };

  cp_data.set_contentitem_metadata = function(data) { cp_data.contentitem_metadata = data; };
  cp_data.get_placeholder_metadata = function() { return cp_data.placeholder_metadata; };
  cp_data.get_initial_placeholders = function() { return cp_data.initial_placeholders; };


  /**
   * Object to describe the metadata of a ContentItem in the formset.
   */
  cp_data.ContentItemInfo = function ContentItemInfo($fs_item)
  {
    // NOTE: assumes the ContentItem was already moved outside it's inline-group.
    // The parsing only happens with the
    var id = $fs_item.attr("id");
    var pos = id.lastIndexOf('-');

    this.fs_item = $fs_item;
    this.index = parseInt(id.substring(pos + 1));

    // The metadata, overwritten by the externally provided `child_inlines` info.
    this.type = $fs_item.data('inlineType');  // data-inline-type
    this.field_prefix = cp_data.get_group_prefix() + "-" + this.index;
    this.plugin = null;
    this.name = null;
    this.contenttype_id = null;
    this.item_template = null;

    // Overwrite properties with global metadata about the ContentItem
    var contentitem_metadata = cp_data.get_contentitem_metadata_by_type(this.type);
    if( contentitem_metadata )
      $.extend(this, contentitem_metadata);
  }

  cp_data.ContentItemInfo.prototype = {
    _field: function(field_name) {
      return this.fs_item.find("#" + this.field_prefix + "-" + field_name);
    },

    get_placeholder_slot: function() {
      return this._field('placeholder_slot').val();
    },

    get_id: function() {
      return parseInt(this._field('id').val());
    },

    get_uid: function() {
      return this._field('item_uid').val();
    },

    get_pane: function() {
      return cp_data.get_placeholder_pane_for_item(this.fs_item);  // TODO: make that function obsolete.
    },

    set_placeholder: function(placeholder) {
      this._field('placeholder').val(placeholder.id);
      this._field('placeholder_slot').val(placeholder.slot);
    },

    set_uid: function() {
      var $uuid_field = this._field('item_uid');
      if(! $uuid_field.val()) {
        $uuid_field.val(generateUUID());
      }
    },

    set_parent_item: function(item) {
      var id = item.get_id();
      if( id ) {
        this._field('parent_item').val(id);
        this._field('parent_item_uid').val('');
      }
      else {
        var uid = item.get_uid();
        this._field('parent_item').val('');
        this._field('parent_item_uid').val(uid);
      }
    },

    set_sort_order: function(sort_order) {
      this._field('sort_order').val(sort_order);
    }
  };

  function PlaceholderPane($pane, placeholder)
  {
    this.root = $pane;  // mainly for debugging
    this.content = $pane.children(".cp-content");
    this.empty_message = $pane.children('.cp-empty');
    this.placeholder = placeholder;
    this.is_orphaned = $pane.attr('data-tab-region') == '__orphaned__';
  }

  function PlaceholderInfo(placeholder, is_fallback)
  {
    this.slot = placeholder.slot;
    this.role = placeholder.role;
    this.items = [];
    this.is_fallback = is_fallback;
  }


  /**
   * Initialize the data collection by reading the DOM.
   *
   * Read all the DOM formsets into the "placeholders" variable.
   * This information is used in this library to lookup formsets.
   */
  cp_data.init = function()
  {
    // Find all formset items.
    var $all_items   = $(".inline-contentitem-group > .inline-related");
    var $empty_items = $all_items.filter(".empty-form");
    var $fs_items    = $all_items.filter(":not(.empty-form)");

    // Group all formset items by the placeholder they belong to.
    // This administration is used as quick lookup, to avoid unneeded DOM querying.
    if( cp_data.placeholder_metadata )
    {
      for(var i = 0; i < $fs_items.length; i++)
      {
        // Get formset DOM elements
        var $fs_item           = $fs_items.eq(i);
        var $placeholder_input = $fs_item.find("input[name$=-placeholder], select[name$=-placeholder]");  // allow <select> for debugging.
        var $placeholder_slot_input = $fs_item.find('input[name$=-placeholder_slot]');

        // placeholder_slot may be __main__, placeholder.slot will be the real one.
        var placeholder_id = $placeholder_input.val();
        var placeholder_slot = $placeholder_slot_input.val();

        // Append item to administration
        var placeholder;
        if(placeholder_id)  // can be empty for add page with form errors
        {
          placeholder = cp_data.get_placeholder_by_id(placeholder_id);   // can be null if item became orphaned.
        }
        else if(placeholder_slot)
        {
          placeholder = cp_data.get_placeholder_by_slot(placeholder_slot)
        }
        var placeholder_info = cp_data.get_or_create_placeholder_info(placeholder, placeholder_id, placeholder_slot);
        placeholder_info.items.push($fs_item);

        // Reset placeholder ID field if the item already
        // doesn't fit in any placeholder.
        if( placeholder_info.is_fallback )
          $placeholder_input.val('');
      }

      if( cp_data.placeholder_metadata.length == 1 )
        $("body").addClass('cp-single-placeholder');
    }

    // Locate all item templates.
    var item_templates = {};
    $(".inline-related.empty-form").each(function(){
      var $empty_form = $(this);
      var inlineType = $empty_form.data('inlineType');  // data-inline-type
      if(inlineType) {
        item_templates[inlineType] = $empty_form;
      }
    });

    // Amend the contentitem metadata with the empty-form template
    var child_inlines = cp_data.contentitem_metadata.child_inlines;
    for(var model_name in child_inlines)
    {
      var item_meta = child_inlines[model_name];
      item_meta.item_template = item_templates[model_name];
    }
  }


  /**
   * @returns {PlaceholderInfo}
   */
  cp_data.get_or_create_placeholder_info = function(placeholder, fallback_id, fallback_slot)
  {
    // If the ID references to a placeholder which was removed from the template,
    // make sure the item is indexed somehow.
    var is_fallback = false;
    if( ! placeholder )
    {
      var slot = fallback_slot || (!fallback_id ? "__orphaned__" : "__orphaned__@" + fallback_id);  // distinguish clearly, easier debugging.
      placeholder = {'slot': slot, 'role': null};
      is_fallback = !fallback_slot;  // slot == __orphaned__
    }

    var placeholder_info = cp_data.placeholders[placeholder.slot];
    if( ! placeholder_info )
    {
      // Create the structure for the placeholder.
      placeholder_info = new PlaceholderInfo(placeholder, is_fallback);
      cp_data.placeholders[placeholder.slot] = placeholder_info;
    }

    return placeholder_info;
  }


  cp_data.get_placeholders = function()
  {
    return cp_data.placeholders;
  }


  /**
   * Find the desired placeholder, including the preferred occurrence of it.
   */
  cp_data.get_placeholder_for_role = function(role, preferredNr)
  {
    if( cp_data.placeholder_metadata == null )
      throw new Error("cp_data.set_placeholders() was never called");

    var candidate = null;
    var itemNr = 0;
    for(var i = 0; i < cp_data.placeholder_metadata.length; i++)
    {
      var placeholder = cp_data.placeholder_metadata[i];
      if(placeholder.role == role)
      {
        candidate = placeholder;
        itemNr++;

        if( itemNr == preferredNr || !preferredNr )
          return candidate;
      }
    }

    return candidate;
  }


  /**
   * See if there is only one placeholder at the page.
   */
  cp_data.get_single_placeholder = function()
  {
    if( cp_data.placeholder_metadata == null )
      throw new Error("cp_data.set_placeholders() was never called");

    if( cp_data.placeholder_metadata.length == 1 ) {
      return cp_data.placeholder_metadata[0];
    }

    return null;
  }


  /**
   * Find the placeholder corresponding with a given ID.
   */
  cp_data.get_placeholder_by_id = function(id)
  {
    if( id == "" )
      return null;
    return _get_placeholder_by_property('id', id);
  }


  /**
   * Find the placeholder corresponding with a given slot.
   */
  cp_data.get_placeholder_by_slot = function(slot)
  {
    if( slot == "" )
      throw new Error("cp_data.get_placeholder_by_slot() received empty value.");
    return _get_placeholder_by_property('slot', slot);
  }


  /**
   * @returns {Object} The JSON data provided by the HTML template.
   */
  function _get_placeholder_by_property(prop, value)
  {
    if( cp_data.placeholder_metadata == null )
      throw new Error("cp_data.set_placeholders() was never called");

    // Special case: if there is only a single placeholder,
    // skip the whole support for multiple placeholders per page.
    if( cp_data.placeholder_metadata.length == 1 && cp_data.placeholder_metadata[0].id == -1 )
      return cp_data.placeholder_metadata[0];

    // Find the item based on the property.
    // The placeholders are not a loopup object, but array to keep sort_order correct.
    for(var i = 0; i < cp_data.placeholder_metadata.length; i++)
      if( cp_data.placeholder_metadata[i][prop] == value )
        return cp_data.placeholder_metadata[i];

    if( window.console )
      window.console.warn("cp_data.get_placeholder_by_" + prop + ": no object for '" + value + "'");
    return null;
  }


  /**
   * Return the DOM elements where the placeholder adds it's contents.
   */
  cp_data.get_placeholder_pane = function(placeholder)
  {
    return cp_data.get_object_for_pane($("#" + placeholder.domnode), placeholder);
  }


  /**
   * Return the placeholder pane for a given FormSet item.
   */
  cp_data.get_placeholder_pane_for_item = function($fs_item)
  {
    var pane = $fs_item.closest(".cp-content").parent();
    return cp_data.get_object_for_pane(pane, undefined);
  }


  /**
   * Return an array of all placeholder pane objects.
   */
  cp_data.get_placeholder_panes = function()
  {
    // Wrap in objects too, for consistent API usage.
    var pane_objects = [];
    for(var i = 0; i < cp_data.placeholder_metadata.length; i++)
    {
      var placeholder = cp_data.placeholder_metadata[i];
      pane_objects.push(cp_data.get_placeholder_pane(placeholder));
    }

    return pane_objects;
  }


  cp_data.get_object_for_pane = function($pane, placeholder)
  {
    if( $pane.length == 0 )
    {
      if( window.console )
        window.console.warn("Pane not found: " + $pane.selector);
      return null;
    }

    return new PlaceholderPane($pane, placeholder);
  }


  cp_data.get_group_prefix = function()
  {
    // Everything is part of a single polymorphic formset.
    return cp_data.contentitem_metadata.auto_id.replace(/%s/, cp_data.contentitem_metadata.prefix);
  }


  cp_data.get_field_prefix = function(index)
  {
    // Everything is part of a single polymorphic formset.
    return cp_data.contentitem_metadata.prefix + "-" + index;
  }


  cp_data.get_formset_dom_info = function(child_node)
  {
    var current_item = cp_data.get_inline_formset_item_info(child_node);
    var group_prefix = cp_data.get_group_prefix();
    var field_prefix = group_prefix + "-" + current_item.index;

    var placeholder_id = $("#" + field_prefix + "-placeholder").val();  // .val allows <select> for debugging.
    var placeholder_slot = $("#" + field_prefix + "-placeholder_slot")[0].value;

    // Placeholder slot may only filled in when creating items,
    // so restore that info from the existing database.
    if( placeholder_id && !placeholder_slot )
      placeholder_slot = cp_data.get_placeholder_by_id(placeholder_id).slot;

    return {
      // for debugging
      root: current_item.fs_item,

      // management form item
      total_forms: $("#" + group_prefix + "-TOTAL_FORMS")[0],

      // Item fields
      id_field: $("#" + field_prefix + "-id"),
      delete_checkbox: $("#" + field_prefix + "-DELETE"),
      placeholder_id: placeholder_id,
      placeholder_slot: placeholder_slot
    };
  }


  /**
   * Given a random child node, return the formset data that the node belongs to.
   * The formset item itself may be moved outside of the original inline group.
   */
  cp_data.get_inline_formset_item_info = function(child_node)
  {
    if( cp_data.contentitem_metadata == null )
      throw new Error("cp_data.set_contentitem_metadata() was never called. Does the ModelAdmin inherit from the correct base class?");
    if( child_node.fs_item )
      return child_node;   // already parsed

    var fs_item = $(child_node).closest(".inline-related");
    return new cp_data.ContentItemInfo(fs_item);
  }


  function _get_contentitem_metadata_by_prop(prop, value)
  {
    if( cp_data.contentitem_metadata == null )
      throw new Error("cp_data.set_contentitem_metadata() was never called");
    if(! value)
      return null;

    var child_inlines = cp_data.contentitem_metadata.child_inlines;
    for(var model_name in child_inlines)
    {
      if(! child_inlines.hasOwnProperty(model_name))
        continue;

      var candidate = child_inlines[model_name];
      if( candidate[prop] == value )
        return candidate;
    }
    return null;
  }


  /**
   * Verify that a given item type exists.
   */
  cp_data.get_contentitem_metadata_by_type = function(model_name)
  {
    if( cp_data.contentitem_metadata == null )
      throw new Error("cp_data.set_contentitem_metadata() was never called. Does the ModelAdmin inherit from the correct base class?");

    return cp_data.contentitem_metadata.child_inlines[model_name];
  }


  /**
   * Return the contentitem metadata for a plugin name.
   */
  cp_data.get_contentitem_metadata_by_plugin = function(plugin)
  {
    return _get_contentitem_metadata_by_prop('plugin', plugin);
  }


  cp_data.cleanup_empty_placeholders = function()
  {
    for(var i = 0; i < cp_data.placeholders.length; i++)
      if(cp_data.placeholders[i].items.length == 0)
        delete cp_data.placeholders[i];
  }


  cp_data.remove_dom_item = function(placeholder_slot, content_item)
  {
    var placeholder_info = cp_data.placeholders[placeholder_slot];
    var raw_node = content_item.fs_item[0];
    for( i = 0; i < placeholder_info.items.length; i++ )
    {
      if( placeholder_info.items[i][0] == raw_node)
      {
        placeholder_info.items.splice(i, 1);
        break;
      }
    }

    return placeholder_info.items.length == 0;
  }

})(window.jQuery || django.jQuery);
