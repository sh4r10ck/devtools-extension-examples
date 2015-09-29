/* See license.txt for terms of usage */

"use strict";

// Add-on SDK
const options = require("@loader/options");
const { Cu, Ci } = require("chrome");
const { Class } = require("sdk/core/heritage");
const { Tool } = require("dev/toolbox");
const { defer, resolve, all } = require("sdk/core/promise");

// Firebug.SDK
const { Rdp } = require("firebug.sdk/lib/core/rdp.js");
const { Locale } = require("firebug.sdk/lib/core/locale.js");
const { Content } = require("firebug.sdk/lib/core/content.js");
const { PanelBase } = require("firebug.sdk/lib/panel-base.js");

// WebSocket Monitor
const { WsmActorFront } = require("./wsm-actor.js");

// Platform
const { Services } = Cu.import("resource://gre/modules/Services.jsm", {});

// Socket.IO Parser
var parser = require('socket.io-parser');

// Constants
const actorModuleUrl = options.prefixURI + "lib/wsm-actor.js";

/**
 * This object represents a new {@Toolbox} panel. This object is
 * running within the chrome scope and ensures basic Toolbox
 * panel aspects such as a tab in the Toolbox tab-bar, etc.
 *
 * The content of the panel is rendered using an iframe that
 * overlaps the entire space. The iframe is called a 'view' and
 * its content is running in content scope (no chrome privileges).
 * HTML in the view is generated using React+Redux libraries.
 *
 * Communication between the panel and view is done through
 * asynchronous messaging.
 */
const WsmPanel = Class(
/** @lends WsmPanel */
{
  extends: PanelBase,

  label: "Web Sockets",
  tooltip: "My panel tooltip",
  icon: "./icon-16.png",
  url: "./view.html",

  /**
   * Executed by the framework when an instance of this panel is created.
   * There is one instance of this panel per {@Toolbox}. The panel is
   * instantiated when selected in the toolbox for the first time.
   */
  initialize: function(options) {
    this.extends.initialize.apply(this, arguments);

    // nsIWebSocketFrameService events
    this.onFrameReceived = this.onFrameReceived.bind(this);
    this.onFrameSent = this.onFrameSent.bind(this);
  },

  onReady: function() {
    this.extends.onReady.apply(this, arguments);
    console.log("WsmPanel.onReady;");
  },

  // Backend

  attach: function() {
    if (this.front) {
      return resolve(this.front);
    }

    // Inspector actor registration options.
    let config = {
      prefix: WsmActorFront.prototype.typeName,
      actorClass: "WsmActor",
      frontClass: WsmActorFront,
      moduleUrl: actorModuleUrl
    };

    let deferred = defer();
    let client = this.toolbox.target.client;

    // Register as tab actor.
    Rdp.registerTabActor(client, config).then(({registrar, front}) => {
      console.log("WsmPanel.attach; Done", front);

      this.front = front;

      // Drag-drop listener (events sent from the backend)
      this.front.on("frameReceived", this.onFrameReceived);
      this.front.on("frameSent", this.onFrameSent);

      // xxxHonza: unregister actor on shutdown/disable/uninstall
      // but not on toolbox close.
      this.registrar = registrar;
    }, response => {
      console.log("WsmPanel.attach; ERROR " + response, response);
    });

    return deferred.promise;
  },

  detach: function() {
    if (!this.front) {
      return resolve();
    }

    let front = this.front;
    let deferred = defer();
    front.detach().then(response => {
      console.log("WsmPanel.detach; Done", response);

      front.off("frameReceived", this.onFrameReceived);
      front.off("frameSent", this.onFrameSent);

      deferred.resolve(response);
    });

    this.front = null;

    return deferred.promise;
  },

  // nsIWebSocketFrameService events

  onFrameReceived: function(data) {
    data.socketIo = this.decodePacket(data.maskBit.payload);
    this.postContentMessage("frameReceived", JSON.stringify(data));
  },

  onFrameSent: function(data) {
    data.socketIo = this.decodePacket(data.header.payload);
    this.postContentMessage("frameSent", JSON.stringify(data));
  },

  // Socket.IO Parser

  decodePacket: function(data) {
    let result;
    try {
      var decoder = new parser.Decoder();
      decoder.on("decoded", function(decodedPacket) {
        if (decodedPacket.data != "parser error") {
          result = decodedPacket;
        }
      });
      decoder.add(data);
    } catch (err) {
      return;
    }
    return result;
  }
});

// Registration
const myTool = new Tool({
  name: "MyTool",
  panels: {
    WsmPanel: WsmPanel
  }
});
