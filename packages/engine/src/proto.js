/*eslint-disable block-scoped-var, id-length, no-control-regex, no-magic-numbers, no-prototype-builtins, no-redeclare, no-shadow, no-var, sort-vars*/
import * as $protobuf from "protobufjs/minimal";

// Common aliases
const $Reader = $protobuf.Reader, $Writer = $protobuf.Writer, $util = $protobuf.util;

// Exported root namespace
const $root = $protobuf.roots["default"] || ($protobuf.roots["default"] = {});

export const onesat = $root.onesat = (() => {

    /**
     * Namespace onesat.
     * @exports onesat
     * @namespace
     */
    const onesat = {};

    onesat.beef = (function() {

        /**
         * Namespace beef.
         * @memberof onesat
         * @namespace
         */
        const beef = {};

        /**
         * DataFormat enum.
         * @name onesat.beef.DataFormat
         * @enum {number}
         * @property {number} RAW_TX=0 RAW_TX value
         * @property {number} RAW_TX_AND_BUMP_INDEX=1 RAW_TX_AND_BUMP_INDEX value
         * @property {number} TXID_ONLY=2 TXID_ONLY value
         */
        beef.DataFormat = (function() {
            const valuesById = {}, values = Object.create(valuesById);
            values[valuesById[0] = "RAW_TX"] = 0;
            values[valuesById[1] = "RAW_TX_AND_BUMP_INDEX"] = 1;
            values[valuesById[2] = "TXID_ONLY"] = 2;
            return values;
        })();

        beef.BeefTx = (function() {

            /**
             * Properties of a BeefTx.
             * @memberof onesat.beef
             * @interface IBeefTx
             * @property {Uint8Array|null} [txid] BeefTx txid
             * @property {onesat.beef.DataFormat|null} [dataFormat] BeefTx dataFormat
             * @property {Uint8Array|null} [rawTx] BeefTx rawTx
             * @property {number|null} [bumpIndex] BeefTx bumpIndex
             */

            /**
             * Constructs a new BeefTx.
             * @memberof onesat.beef
             * @classdesc Represents a BeefTx.
             * @implements IBeefTx
             * @constructor
             * @param {onesat.beef.IBeefTx=} [properties] Properties to set
             */
            function BeefTx(properties) {
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null)
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * BeefTx txid.
             * @member {Uint8Array} txid
             * @memberof onesat.beef.BeefTx
             * @instance
             */
            BeefTx.prototype.txid = $util.newBuffer([]);

            /**
             * BeefTx dataFormat.
             * @member {onesat.beef.DataFormat} dataFormat
             * @memberof onesat.beef.BeefTx
             * @instance
             */
            BeefTx.prototype.dataFormat = 0;

            /**
             * BeefTx rawTx.
             * @member {Uint8Array} rawTx
             * @memberof onesat.beef.BeefTx
             * @instance
             */
            BeefTx.prototype.rawTx = $util.newBuffer([]);

            /**
             * BeefTx bumpIndex.
             * @member {number|null|undefined} bumpIndex
             * @memberof onesat.beef.BeefTx
             * @instance
             */
            BeefTx.prototype.bumpIndex = null;

            // OneOf field names bound to virtual getters and setters
            let $oneOfFields;

            // Virtual OneOf for proto3 optional field
            Object.defineProperty(BeefTx.prototype, "_bumpIndex", {
                get: $util.oneOfGetter($oneOfFields = ["bumpIndex"]),
                set: $util.oneOfSetter($oneOfFields)
            });

            /**
             * Creates a new BeefTx instance using the specified properties.
             * @function create
             * @memberof onesat.beef.BeefTx
             * @static
             * @param {onesat.beef.IBeefTx=} [properties] Properties to set
             * @returns {onesat.beef.BeefTx} BeefTx instance
             */
            BeefTx.create = function create(properties) {
                return new BeefTx(properties);
            };

            /**
             * Encodes the specified BeefTx message. Does not implicitly {@link onesat.beef.BeefTx.verify|verify} messages.
             * @function encode
             * @memberof onesat.beef.BeefTx
             * @static
             * @param {onesat.beef.IBeefTx} message BeefTx message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            BeefTx.encode = function encode(message, writer) {
                if (!writer)
                    writer = $Writer.create();
                if (message.txid != null && Object.hasOwnProperty.call(message, "txid"))
                    writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.txid);
                if (message.dataFormat != null && Object.hasOwnProperty.call(message, "dataFormat"))
                    writer.uint32(/* id 2, wireType 0 =*/16).int32(message.dataFormat);
                if (message.rawTx != null && Object.hasOwnProperty.call(message, "rawTx"))
                    writer.uint32(/* id 3, wireType 2 =*/26).bytes(message.rawTx);
                if (message.bumpIndex != null && Object.hasOwnProperty.call(message, "bumpIndex"))
                    writer.uint32(/* id 4, wireType 0 =*/32).uint32(message.bumpIndex);
                return writer;
            };

            /**
             * Encodes the specified BeefTx message, length delimited. Does not implicitly {@link onesat.beef.BeefTx.verify|verify} messages.
             * @function encodeDelimited
             * @memberof onesat.beef.BeefTx
             * @static
             * @param {onesat.beef.IBeefTx} message BeefTx message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            BeefTx.encodeDelimited = function encodeDelimited(message, writer) {
                return this.encode(message, writer).ldelim();
            };

            /**
             * Decodes a BeefTx message from the specified reader or buffer.
             * @function decode
             * @memberof onesat.beef.BeefTx
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {onesat.beef.BeefTx} BeefTx
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            BeefTx.decode = function decode(reader, length, error) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.onesat.beef.BeefTx();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.txid = reader.bytes();
                            break;
                        }
                    case 2: {
                            message.dataFormat = reader.int32();
                            break;
                        }
                    case 3: {
                            message.rawTx = reader.bytes();
                            break;
                        }
                    case 4: {
                            message.bumpIndex = reader.uint32();
                            break;
                        }
                    default:
                        reader.skipType(tag & 7);
                        break;
                    }
                }
                return message;
            };

            /**
             * Decodes a BeefTx message from the specified reader or buffer, length delimited.
             * @function decodeDelimited
             * @memberof onesat.beef.BeefTx
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @returns {onesat.beef.BeefTx} BeefTx
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            BeefTx.decodeDelimited = function decodeDelimited(reader) {
                if (!(reader instanceof $Reader))
                    reader = new $Reader(reader);
                return this.decode(reader, reader.uint32());
            };

            /**
             * Verifies a BeefTx message.
             * @function verify
             * @memberof onesat.beef.BeefTx
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            BeefTx.verify = function verify(message) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                let properties = {};
                if (message.txid != null && message.hasOwnProperty("txid"))
                    if (!(message.txid && typeof message.txid.length === "number" || $util.isString(message.txid)))
                        return "txid: buffer expected";
                if (message.dataFormat != null && message.hasOwnProperty("dataFormat"))
                    switch (message.dataFormat) {
                    default:
                        return "dataFormat: enum value expected";
                    case 0:
                    case 1:
                    case 2:
                        break;
                    }
                if (message.rawTx != null && message.hasOwnProperty("rawTx"))
                    if (!(message.rawTx && typeof message.rawTx.length === "number" || $util.isString(message.rawTx)))
                        return "rawTx: buffer expected";
                if (message.bumpIndex != null && message.hasOwnProperty("bumpIndex")) {
                    properties._bumpIndex = 1;
                    if (!$util.isInteger(message.bumpIndex))
                        return "bumpIndex: integer expected";
                }
                return null;
            };

            /**
             * Creates a BeefTx message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof onesat.beef.BeefTx
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {onesat.beef.BeefTx} BeefTx
             */
            BeefTx.fromObject = function fromObject(object) {
                if (object instanceof $root.onesat.beef.BeefTx)
                    return object;
                let message = new $root.onesat.beef.BeefTx();
                if (object.txid != null)
                    if (typeof object.txid === "string")
                        $util.base64.decode(object.txid, message.txid = $util.newBuffer($util.base64.length(object.txid)), 0);
                    else if (object.txid.length >= 0)
                        message.txid = object.txid;
                switch (object.dataFormat) {
                default:
                    if (typeof object.dataFormat === "number") {
                        message.dataFormat = object.dataFormat;
                        break;
                    }
                    break;
                case "RAW_TX":
                case 0:
                    message.dataFormat = 0;
                    break;
                case "RAW_TX_AND_BUMP_INDEX":
                case 1:
                    message.dataFormat = 1;
                    break;
                case "TXID_ONLY":
                case 2:
                    message.dataFormat = 2;
                    break;
                }
                if (object.rawTx != null)
                    if (typeof object.rawTx === "string")
                        $util.base64.decode(object.rawTx, message.rawTx = $util.newBuffer($util.base64.length(object.rawTx)), 0);
                    else if (object.rawTx.length >= 0)
                        message.rawTx = object.rawTx;
                if (object.bumpIndex != null)
                    message.bumpIndex = object.bumpIndex >>> 0;
                return message;
            };

            /**
             * Creates a plain object from a BeefTx message. Also converts values to other types if specified.
             * @function toObject
             * @memberof onesat.beef.BeefTx
             * @static
             * @param {onesat.beef.BeefTx} message BeefTx
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            BeefTx.toObject = function toObject(message, options) {
                if (!options)
                    options = {};
                let object = {};
                if (options.defaults) {
                    if (options.bytes === String)
                        object.txid = "";
                    else {
                        object.txid = [];
                        if (options.bytes !== Array)
                            object.txid = $util.newBuffer(object.txid);
                    }
                    object.dataFormat = options.enums === String ? "RAW_TX" : 0;
                    if (options.bytes === String)
                        object.rawTx = "";
                    else {
                        object.rawTx = [];
                        if (options.bytes !== Array)
                            object.rawTx = $util.newBuffer(object.rawTx);
                    }
                }
                if (message.txid != null && message.hasOwnProperty("txid"))
                    object.txid = options.bytes === String ? $util.base64.encode(message.txid, 0, message.txid.length) : options.bytes === Array ? Array.prototype.slice.call(message.txid) : message.txid;
                if (message.dataFormat != null && message.hasOwnProperty("dataFormat"))
                    object.dataFormat = options.enums === String ? $root.onesat.beef.DataFormat[message.dataFormat] === undefined ? message.dataFormat : $root.onesat.beef.DataFormat[message.dataFormat] : message.dataFormat;
                if (message.rawTx != null && message.hasOwnProperty("rawTx"))
                    object.rawTx = options.bytes === String ? $util.base64.encode(message.rawTx, 0, message.rawTx.length) : options.bytes === Array ? Array.prototype.slice.call(message.rawTx) : message.rawTx;
                if (message.bumpIndex != null && message.hasOwnProperty("bumpIndex")) {
                    object.bumpIndex = message.bumpIndex;
                    if (options.oneofs)
                        object._bumpIndex = "bumpIndex";
                }
                return object;
            };

            /**
             * Converts this BeefTx to JSON.
             * @function toJSON
             * @memberof onesat.beef.BeefTx
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            BeefTx.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for BeefTx
             * @function getTypeUrl
             * @memberof onesat.beef.BeefTx
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            BeefTx.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/onesat.beef.BeefTx";
            };

            return BeefTx;
        })();

        beef.Beef = (function() {

            /**
             * Properties of a Beef.
             * @memberof onesat.beef
             * @interface IBeef
             * @property {Array.<onesat.beef.IMerklePath>|null} [bumps] Beef bumps
             * @property {Array.<onesat.beef.IBeefTx>|null} [transactions] Beef transactions
             */

            /**
             * Constructs a new Beef.
             * @memberof onesat.beef
             * @classdesc Represents a Beef.
             * @implements IBeef
             * @constructor
             * @param {onesat.beef.IBeef=} [properties] Properties to set
             */
            function Beef(properties) {
                this.bumps = [];
                this.transactions = [];
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null)
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * Beef bumps.
             * @member {Array.<onesat.beef.IMerklePath>} bumps
             * @memberof onesat.beef.Beef
             * @instance
             */
            Beef.prototype.bumps = $util.emptyArray;

            /**
             * Beef transactions.
             * @member {Array.<onesat.beef.IBeefTx>} transactions
             * @memberof onesat.beef.Beef
             * @instance
             */
            Beef.prototype.transactions = $util.emptyArray;

            /**
             * Creates a new Beef instance using the specified properties.
             * @function create
             * @memberof onesat.beef.Beef
             * @static
             * @param {onesat.beef.IBeef=} [properties] Properties to set
             * @returns {onesat.beef.Beef} Beef instance
             */
            Beef.create = function create(properties) {
                return new Beef(properties);
            };

            /**
             * Encodes the specified Beef message. Does not implicitly {@link onesat.beef.Beef.verify|verify} messages.
             * @function encode
             * @memberof onesat.beef.Beef
             * @static
             * @param {onesat.beef.IBeef} message Beef message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            Beef.encode = function encode(message, writer) {
                if (!writer)
                    writer = $Writer.create();
                if (message.bumps != null && message.bumps.length)
                    for (let i = 0; i < message.bumps.length; ++i)
                        $root.onesat.beef.MerklePath.encode(message.bumps[i], writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
                if (message.transactions != null && message.transactions.length)
                    for (let i = 0; i < message.transactions.length; ++i)
                        $root.onesat.beef.BeefTx.encode(message.transactions[i], writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
                return writer;
            };

            /**
             * Encodes the specified Beef message, length delimited. Does not implicitly {@link onesat.beef.Beef.verify|verify} messages.
             * @function encodeDelimited
             * @memberof onesat.beef.Beef
             * @static
             * @param {onesat.beef.IBeef} message Beef message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            Beef.encodeDelimited = function encodeDelimited(message, writer) {
                return this.encode(message, writer).ldelim();
            };

            /**
             * Decodes a Beef message from the specified reader or buffer.
             * @function decode
             * @memberof onesat.beef.Beef
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {onesat.beef.Beef} Beef
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            Beef.decode = function decode(reader, length, error) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.onesat.beef.Beef();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            if (!(message.bumps && message.bumps.length))
                                message.bumps = [];
                            message.bumps.push($root.onesat.beef.MerklePath.decode(reader, reader.uint32()));
                            break;
                        }
                    case 2: {
                            if (!(message.transactions && message.transactions.length))
                                message.transactions = [];
                            message.transactions.push($root.onesat.beef.BeefTx.decode(reader, reader.uint32()));
                            break;
                        }
                    default:
                        reader.skipType(tag & 7);
                        break;
                    }
                }
                return message;
            };

            /**
             * Decodes a Beef message from the specified reader or buffer, length delimited.
             * @function decodeDelimited
             * @memberof onesat.beef.Beef
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @returns {onesat.beef.Beef} Beef
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            Beef.decodeDelimited = function decodeDelimited(reader) {
                if (!(reader instanceof $Reader))
                    reader = new $Reader(reader);
                return this.decode(reader, reader.uint32());
            };

            /**
             * Verifies a Beef message.
             * @function verify
             * @memberof onesat.beef.Beef
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            Beef.verify = function verify(message) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (message.bumps != null && message.hasOwnProperty("bumps")) {
                    if (!Array.isArray(message.bumps))
                        return "bumps: array expected";
                    for (let i = 0; i < message.bumps.length; ++i) {
                        let error = $root.onesat.beef.MerklePath.verify(message.bumps[i]);
                        if (error)
                            return "bumps." + error;
                    }
                }
                if (message.transactions != null && message.hasOwnProperty("transactions")) {
                    if (!Array.isArray(message.transactions))
                        return "transactions: array expected";
                    for (let i = 0; i < message.transactions.length; ++i) {
                        let error = $root.onesat.beef.BeefTx.verify(message.transactions[i]);
                        if (error)
                            return "transactions." + error;
                    }
                }
                return null;
            };

            /**
             * Creates a Beef message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof onesat.beef.Beef
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {onesat.beef.Beef} Beef
             */
            Beef.fromObject = function fromObject(object) {
                if (object instanceof $root.onesat.beef.Beef)
                    return object;
                let message = new $root.onesat.beef.Beef();
                if (object.bumps) {
                    if (!Array.isArray(object.bumps))
                        throw TypeError(".onesat.beef.Beef.bumps: array expected");
                    message.bumps = [];
                    for (let i = 0; i < object.bumps.length; ++i) {
                        if (typeof object.bumps[i] !== "object")
                            throw TypeError(".onesat.beef.Beef.bumps: object expected");
                        message.bumps[i] = $root.onesat.beef.MerklePath.fromObject(object.bumps[i]);
                    }
                }
                if (object.transactions) {
                    if (!Array.isArray(object.transactions))
                        throw TypeError(".onesat.beef.Beef.transactions: array expected");
                    message.transactions = [];
                    for (let i = 0; i < object.transactions.length; ++i) {
                        if (typeof object.transactions[i] !== "object")
                            throw TypeError(".onesat.beef.Beef.transactions: object expected");
                        message.transactions[i] = $root.onesat.beef.BeefTx.fromObject(object.transactions[i]);
                    }
                }
                return message;
            };

            /**
             * Creates a plain object from a Beef message. Also converts values to other types if specified.
             * @function toObject
             * @memberof onesat.beef.Beef
             * @static
             * @param {onesat.beef.Beef} message Beef
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            Beef.toObject = function toObject(message, options) {
                if (!options)
                    options = {};
                let object = {};
                if (options.arrays || options.defaults) {
                    object.bumps = [];
                    object.transactions = [];
                }
                if (message.bumps && message.bumps.length) {
                    object.bumps = [];
                    for (let j = 0; j < message.bumps.length; ++j)
                        object.bumps[j] = $root.onesat.beef.MerklePath.toObject(message.bumps[j], options);
                }
                if (message.transactions && message.transactions.length) {
                    object.transactions = [];
                    for (let j = 0; j < message.transactions.length; ++j)
                        object.transactions[j] = $root.onesat.beef.BeefTx.toObject(message.transactions[j], options);
                }
                return object;
            };

            /**
             * Converts this Beef to JSON.
             * @function toJSON
             * @memberof onesat.beef.Beef
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            Beef.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for Beef
             * @function getTypeUrl
             * @memberof onesat.beef.Beef
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            Beef.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/onesat.beef.Beef";
            };

            return Beef;
        })();

        beef.AtomicBeef = (function() {

            /**
             * Properties of an AtomicBeef.
             * @memberof onesat.beef
             * @interface IAtomicBeef
             * @property {Uint8Array|null} [txid] AtomicBeef txid
             * @property {onesat.beef.IBeef|null} [beef] AtomicBeef beef
             */

            /**
             * Constructs a new AtomicBeef.
             * @memberof onesat.beef
             * @classdesc Represents an AtomicBeef.
             * @implements IAtomicBeef
             * @constructor
             * @param {onesat.beef.IAtomicBeef=} [properties] Properties to set
             */
            function AtomicBeef(properties) {
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null)
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * AtomicBeef txid.
             * @member {Uint8Array} txid
             * @memberof onesat.beef.AtomicBeef
             * @instance
             */
            AtomicBeef.prototype.txid = $util.newBuffer([]);

            /**
             * AtomicBeef beef.
             * @member {onesat.beef.IBeef|null|undefined} beef
             * @memberof onesat.beef.AtomicBeef
             * @instance
             */
            AtomicBeef.prototype.beef = null;

            /**
             * Creates a new AtomicBeef instance using the specified properties.
             * @function create
             * @memberof onesat.beef.AtomicBeef
             * @static
             * @param {onesat.beef.IAtomicBeef=} [properties] Properties to set
             * @returns {onesat.beef.AtomicBeef} AtomicBeef instance
             */
            AtomicBeef.create = function create(properties) {
                return new AtomicBeef(properties);
            };

            /**
             * Encodes the specified AtomicBeef message. Does not implicitly {@link onesat.beef.AtomicBeef.verify|verify} messages.
             * @function encode
             * @memberof onesat.beef.AtomicBeef
             * @static
             * @param {onesat.beef.IAtomicBeef} message AtomicBeef message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            AtomicBeef.encode = function encode(message, writer) {
                if (!writer)
                    writer = $Writer.create();
                if (message.txid != null && Object.hasOwnProperty.call(message, "txid"))
                    writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.txid);
                if (message.beef != null && Object.hasOwnProperty.call(message, "beef"))
                    $root.onesat.beef.Beef.encode(message.beef, writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
                return writer;
            };

            /**
             * Encodes the specified AtomicBeef message, length delimited. Does not implicitly {@link onesat.beef.AtomicBeef.verify|verify} messages.
             * @function encodeDelimited
             * @memberof onesat.beef.AtomicBeef
             * @static
             * @param {onesat.beef.IAtomicBeef} message AtomicBeef message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            AtomicBeef.encodeDelimited = function encodeDelimited(message, writer) {
                return this.encode(message, writer).ldelim();
            };

            /**
             * Decodes an AtomicBeef message from the specified reader or buffer.
             * @function decode
             * @memberof onesat.beef.AtomicBeef
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {onesat.beef.AtomicBeef} AtomicBeef
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            AtomicBeef.decode = function decode(reader, length, error) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.onesat.beef.AtomicBeef();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.txid = reader.bytes();
                            break;
                        }
                    case 2: {
                            message.beef = $root.onesat.beef.Beef.decode(reader, reader.uint32());
                            break;
                        }
                    default:
                        reader.skipType(tag & 7);
                        break;
                    }
                }
                return message;
            };

            /**
             * Decodes an AtomicBeef message from the specified reader or buffer, length delimited.
             * @function decodeDelimited
             * @memberof onesat.beef.AtomicBeef
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @returns {onesat.beef.AtomicBeef} AtomicBeef
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            AtomicBeef.decodeDelimited = function decodeDelimited(reader) {
                if (!(reader instanceof $Reader))
                    reader = new $Reader(reader);
                return this.decode(reader, reader.uint32());
            };

            /**
             * Verifies an AtomicBeef message.
             * @function verify
             * @memberof onesat.beef.AtomicBeef
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            AtomicBeef.verify = function verify(message) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (message.txid != null && message.hasOwnProperty("txid"))
                    if (!(message.txid && typeof message.txid.length === "number" || $util.isString(message.txid)))
                        return "txid: buffer expected";
                if (message.beef != null && message.hasOwnProperty("beef")) {
                    let error = $root.onesat.beef.Beef.verify(message.beef);
                    if (error)
                        return "beef." + error;
                }
                return null;
            };

            /**
             * Creates an AtomicBeef message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof onesat.beef.AtomicBeef
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {onesat.beef.AtomicBeef} AtomicBeef
             */
            AtomicBeef.fromObject = function fromObject(object) {
                if (object instanceof $root.onesat.beef.AtomicBeef)
                    return object;
                let message = new $root.onesat.beef.AtomicBeef();
                if (object.txid != null)
                    if (typeof object.txid === "string")
                        $util.base64.decode(object.txid, message.txid = $util.newBuffer($util.base64.length(object.txid)), 0);
                    else if (object.txid.length >= 0)
                        message.txid = object.txid;
                if (object.beef != null) {
                    if (typeof object.beef !== "object")
                        throw TypeError(".onesat.beef.AtomicBeef.beef: object expected");
                    message.beef = $root.onesat.beef.Beef.fromObject(object.beef);
                }
                return message;
            };

            /**
             * Creates a plain object from an AtomicBeef message. Also converts values to other types if specified.
             * @function toObject
             * @memberof onesat.beef.AtomicBeef
             * @static
             * @param {onesat.beef.AtomicBeef} message AtomicBeef
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            AtomicBeef.toObject = function toObject(message, options) {
                if (!options)
                    options = {};
                let object = {};
                if (options.defaults) {
                    if (options.bytes === String)
                        object.txid = "";
                    else {
                        object.txid = [];
                        if (options.bytes !== Array)
                            object.txid = $util.newBuffer(object.txid);
                    }
                    object.beef = null;
                }
                if (message.txid != null && message.hasOwnProperty("txid"))
                    object.txid = options.bytes === String ? $util.base64.encode(message.txid, 0, message.txid.length) : options.bytes === Array ? Array.prototype.slice.call(message.txid) : message.txid;
                if (message.beef != null && message.hasOwnProperty("beef"))
                    object.beef = $root.onesat.beef.Beef.toObject(message.beef, options);
                return object;
            };

            /**
             * Converts this AtomicBeef to JSON.
             * @function toJSON
             * @memberof onesat.beef.AtomicBeef
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            AtomicBeef.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for AtomicBeef
             * @function getTypeUrl
             * @memberof onesat.beef.AtomicBeef
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            AtomicBeef.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/onesat.beef.AtomicBeef";
            };

            return AtomicBeef;
        })();

        beef.MerklePath = (function() {

            /**
             * Properties of a MerklePath.
             * @memberof onesat.beef
             * @interface IMerklePath
             * @property {number|null} [blockHeight] MerklePath blockHeight
             * @property {Array.<onesat.beef.IPathLevel>|null} [path] MerklePath path
             */

            /**
             * Constructs a new MerklePath.
             * @memberof onesat.beef
             * @classdesc Represents a MerklePath.
             * @implements IMerklePath
             * @constructor
             * @param {onesat.beef.IMerklePath=} [properties] Properties to set
             */
            function MerklePath(properties) {
                this.path = [];
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null)
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * MerklePath blockHeight.
             * @member {number} blockHeight
             * @memberof onesat.beef.MerklePath
             * @instance
             */
            MerklePath.prototype.blockHeight = 0;

            /**
             * MerklePath path.
             * @member {Array.<onesat.beef.IPathLevel>} path
             * @memberof onesat.beef.MerklePath
             * @instance
             */
            MerklePath.prototype.path = $util.emptyArray;

            /**
             * Creates a new MerklePath instance using the specified properties.
             * @function create
             * @memberof onesat.beef.MerklePath
             * @static
             * @param {onesat.beef.IMerklePath=} [properties] Properties to set
             * @returns {onesat.beef.MerklePath} MerklePath instance
             */
            MerklePath.create = function create(properties) {
                return new MerklePath(properties);
            };

            /**
             * Encodes the specified MerklePath message. Does not implicitly {@link onesat.beef.MerklePath.verify|verify} messages.
             * @function encode
             * @memberof onesat.beef.MerklePath
             * @static
             * @param {onesat.beef.IMerklePath} message MerklePath message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            MerklePath.encode = function encode(message, writer) {
                if (!writer)
                    writer = $Writer.create();
                if (message.blockHeight != null && Object.hasOwnProperty.call(message, "blockHeight"))
                    writer.uint32(/* id 1, wireType 0 =*/8).uint32(message.blockHeight);
                if (message.path != null && message.path.length)
                    for (let i = 0; i < message.path.length; ++i)
                        $root.onesat.beef.PathLevel.encode(message.path[i], writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
                return writer;
            };

            /**
             * Encodes the specified MerklePath message, length delimited. Does not implicitly {@link onesat.beef.MerklePath.verify|verify} messages.
             * @function encodeDelimited
             * @memberof onesat.beef.MerklePath
             * @static
             * @param {onesat.beef.IMerklePath} message MerklePath message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            MerklePath.encodeDelimited = function encodeDelimited(message, writer) {
                return this.encode(message, writer).ldelim();
            };

            /**
             * Decodes a MerklePath message from the specified reader or buffer.
             * @function decode
             * @memberof onesat.beef.MerklePath
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {onesat.beef.MerklePath} MerklePath
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            MerklePath.decode = function decode(reader, length, error) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.onesat.beef.MerklePath();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.blockHeight = reader.uint32();
                            break;
                        }
                    case 2: {
                            if (!(message.path && message.path.length))
                                message.path = [];
                            message.path.push($root.onesat.beef.PathLevel.decode(reader, reader.uint32()));
                            break;
                        }
                    default:
                        reader.skipType(tag & 7);
                        break;
                    }
                }
                return message;
            };

            /**
             * Decodes a MerklePath message from the specified reader or buffer, length delimited.
             * @function decodeDelimited
             * @memberof onesat.beef.MerklePath
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @returns {onesat.beef.MerklePath} MerklePath
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            MerklePath.decodeDelimited = function decodeDelimited(reader) {
                if (!(reader instanceof $Reader))
                    reader = new $Reader(reader);
                return this.decode(reader, reader.uint32());
            };

            /**
             * Verifies a MerklePath message.
             * @function verify
             * @memberof onesat.beef.MerklePath
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            MerklePath.verify = function verify(message) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (message.blockHeight != null && message.hasOwnProperty("blockHeight"))
                    if (!$util.isInteger(message.blockHeight))
                        return "blockHeight: integer expected";
                if (message.path != null && message.hasOwnProperty("path")) {
                    if (!Array.isArray(message.path))
                        return "path: array expected";
                    for (let i = 0; i < message.path.length; ++i) {
                        let error = $root.onesat.beef.PathLevel.verify(message.path[i]);
                        if (error)
                            return "path." + error;
                    }
                }
                return null;
            };

            /**
             * Creates a MerklePath message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof onesat.beef.MerklePath
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {onesat.beef.MerklePath} MerklePath
             */
            MerklePath.fromObject = function fromObject(object) {
                if (object instanceof $root.onesat.beef.MerklePath)
                    return object;
                let message = new $root.onesat.beef.MerklePath();
                if (object.blockHeight != null)
                    message.blockHeight = object.blockHeight >>> 0;
                if (object.path) {
                    if (!Array.isArray(object.path))
                        throw TypeError(".onesat.beef.MerklePath.path: array expected");
                    message.path = [];
                    for (let i = 0; i < object.path.length; ++i) {
                        if (typeof object.path[i] !== "object")
                            throw TypeError(".onesat.beef.MerklePath.path: object expected");
                        message.path[i] = $root.onesat.beef.PathLevel.fromObject(object.path[i]);
                    }
                }
                return message;
            };

            /**
             * Creates a plain object from a MerklePath message. Also converts values to other types if specified.
             * @function toObject
             * @memberof onesat.beef.MerklePath
             * @static
             * @param {onesat.beef.MerklePath} message MerklePath
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            MerklePath.toObject = function toObject(message, options) {
                if (!options)
                    options = {};
                let object = {};
                if (options.arrays || options.defaults)
                    object.path = [];
                if (options.defaults)
                    object.blockHeight = 0;
                if (message.blockHeight != null && message.hasOwnProperty("blockHeight"))
                    object.blockHeight = message.blockHeight;
                if (message.path && message.path.length) {
                    object.path = [];
                    for (let j = 0; j < message.path.length; ++j)
                        object.path[j] = $root.onesat.beef.PathLevel.toObject(message.path[j], options);
                }
                return object;
            };

            /**
             * Converts this MerklePath to JSON.
             * @function toJSON
             * @memberof onesat.beef.MerklePath
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            MerklePath.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for MerklePath
             * @function getTypeUrl
             * @memberof onesat.beef.MerklePath
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            MerklePath.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/onesat.beef.MerklePath";
            };

            return MerklePath;
        })();

        beef.PathLevel = (function() {

            /**
             * Properties of a PathLevel.
             * @memberof onesat.beef
             * @interface IPathLevel
             * @property {Array.<onesat.beef.IPathElement>|null} [elements] PathLevel elements
             */

            /**
             * Constructs a new PathLevel.
             * @memberof onesat.beef
             * @classdesc Represents a PathLevel.
             * @implements IPathLevel
             * @constructor
             * @param {onesat.beef.IPathLevel=} [properties] Properties to set
             */
            function PathLevel(properties) {
                this.elements = [];
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null)
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * PathLevel elements.
             * @member {Array.<onesat.beef.IPathElement>} elements
             * @memberof onesat.beef.PathLevel
             * @instance
             */
            PathLevel.prototype.elements = $util.emptyArray;

            /**
             * Creates a new PathLevel instance using the specified properties.
             * @function create
             * @memberof onesat.beef.PathLevel
             * @static
             * @param {onesat.beef.IPathLevel=} [properties] Properties to set
             * @returns {onesat.beef.PathLevel} PathLevel instance
             */
            PathLevel.create = function create(properties) {
                return new PathLevel(properties);
            };

            /**
             * Encodes the specified PathLevel message. Does not implicitly {@link onesat.beef.PathLevel.verify|verify} messages.
             * @function encode
             * @memberof onesat.beef.PathLevel
             * @static
             * @param {onesat.beef.IPathLevel} message PathLevel message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            PathLevel.encode = function encode(message, writer) {
                if (!writer)
                    writer = $Writer.create();
                if (message.elements != null && message.elements.length)
                    for (let i = 0; i < message.elements.length; ++i)
                        $root.onesat.beef.PathElement.encode(message.elements[i], writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
                return writer;
            };

            /**
             * Encodes the specified PathLevel message, length delimited. Does not implicitly {@link onesat.beef.PathLevel.verify|verify} messages.
             * @function encodeDelimited
             * @memberof onesat.beef.PathLevel
             * @static
             * @param {onesat.beef.IPathLevel} message PathLevel message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            PathLevel.encodeDelimited = function encodeDelimited(message, writer) {
                return this.encode(message, writer).ldelim();
            };

            /**
             * Decodes a PathLevel message from the specified reader or buffer.
             * @function decode
             * @memberof onesat.beef.PathLevel
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {onesat.beef.PathLevel} PathLevel
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            PathLevel.decode = function decode(reader, length, error) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.onesat.beef.PathLevel();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            if (!(message.elements && message.elements.length))
                                message.elements = [];
                            message.elements.push($root.onesat.beef.PathElement.decode(reader, reader.uint32()));
                            break;
                        }
                    default:
                        reader.skipType(tag & 7);
                        break;
                    }
                }
                return message;
            };

            /**
             * Decodes a PathLevel message from the specified reader or buffer, length delimited.
             * @function decodeDelimited
             * @memberof onesat.beef.PathLevel
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @returns {onesat.beef.PathLevel} PathLevel
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            PathLevel.decodeDelimited = function decodeDelimited(reader) {
                if (!(reader instanceof $Reader))
                    reader = new $Reader(reader);
                return this.decode(reader, reader.uint32());
            };

            /**
             * Verifies a PathLevel message.
             * @function verify
             * @memberof onesat.beef.PathLevel
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            PathLevel.verify = function verify(message) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (message.elements != null && message.hasOwnProperty("elements")) {
                    if (!Array.isArray(message.elements))
                        return "elements: array expected";
                    for (let i = 0; i < message.elements.length; ++i) {
                        let error = $root.onesat.beef.PathElement.verify(message.elements[i]);
                        if (error)
                            return "elements." + error;
                    }
                }
                return null;
            };

            /**
             * Creates a PathLevel message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof onesat.beef.PathLevel
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {onesat.beef.PathLevel} PathLevel
             */
            PathLevel.fromObject = function fromObject(object) {
                if (object instanceof $root.onesat.beef.PathLevel)
                    return object;
                let message = new $root.onesat.beef.PathLevel();
                if (object.elements) {
                    if (!Array.isArray(object.elements))
                        throw TypeError(".onesat.beef.PathLevel.elements: array expected");
                    message.elements = [];
                    for (let i = 0; i < object.elements.length; ++i) {
                        if (typeof object.elements[i] !== "object")
                            throw TypeError(".onesat.beef.PathLevel.elements: object expected");
                        message.elements[i] = $root.onesat.beef.PathElement.fromObject(object.elements[i]);
                    }
                }
                return message;
            };

            /**
             * Creates a plain object from a PathLevel message. Also converts values to other types if specified.
             * @function toObject
             * @memberof onesat.beef.PathLevel
             * @static
             * @param {onesat.beef.PathLevel} message PathLevel
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            PathLevel.toObject = function toObject(message, options) {
                if (!options)
                    options = {};
                let object = {};
                if (options.arrays || options.defaults)
                    object.elements = [];
                if (message.elements && message.elements.length) {
                    object.elements = [];
                    for (let j = 0; j < message.elements.length; ++j)
                        object.elements[j] = $root.onesat.beef.PathElement.toObject(message.elements[j], options);
                }
                return object;
            };

            /**
             * Converts this PathLevel to JSON.
             * @function toJSON
             * @memberof onesat.beef.PathLevel
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            PathLevel.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for PathLevel
             * @function getTypeUrl
             * @memberof onesat.beef.PathLevel
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            PathLevel.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/onesat.beef.PathLevel";
            };

            return PathLevel;
        })();

        beef.PathElement = (function() {

            /**
             * Properties of a PathElement.
             * @memberof onesat.beef
             * @interface IPathElement
             * @property {number|Long|null} [offset] PathElement offset
             * @property {Uint8Array|null} [hash] PathElement hash
             * @property {boolean|null} [txid] PathElement txid
             * @property {boolean|null} [duplicate] PathElement duplicate
             */

            /**
             * Constructs a new PathElement.
             * @memberof onesat.beef
             * @classdesc Represents a PathElement.
             * @implements IPathElement
             * @constructor
             * @param {onesat.beef.IPathElement=} [properties] Properties to set
             */
            function PathElement(properties) {
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null)
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * PathElement offset.
             * @member {number|Long} offset
             * @memberof onesat.beef.PathElement
             * @instance
             */
            PathElement.prototype.offset = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

            /**
             * PathElement hash.
             * @member {Uint8Array} hash
             * @memberof onesat.beef.PathElement
             * @instance
             */
            PathElement.prototype.hash = $util.newBuffer([]);

            /**
             * PathElement txid.
             * @member {boolean} txid
             * @memberof onesat.beef.PathElement
             * @instance
             */
            PathElement.prototype.txid = false;

            /**
             * PathElement duplicate.
             * @member {boolean} duplicate
             * @memberof onesat.beef.PathElement
             * @instance
             */
            PathElement.prototype.duplicate = false;

            /**
             * Creates a new PathElement instance using the specified properties.
             * @function create
             * @memberof onesat.beef.PathElement
             * @static
             * @param {onesat.beef.IPathElement=} [properties] Properties to set
             * @returns {onesat.beef.PathElement} PathElement instance
             */
            PathElement.create = function create(properties) {
                return new PathElement(properties);
            };

            /**
             * Encodes the specified PathElement message. Does not implicitly {@link onesat.beef.PathElement.verify|verify} messages.
             * @function encode
             * @memberof onesat.beef.PathElement
             * @static
             * @param {onesat.beef.IPathElement} message PathElement message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            PathElement.encode = function encode(message, writer) {
                if (!writer)
                    writer = $Writer.create();
                if (message.offset != null && Object.hasOwnProperty.call(message, "offset"))
                    writer.uint32(/* id 1, wireType 0 =*/8).uint64(message.offset);
                if (message.hash != null && Object.hasOwnProperty.call(message, "hash"))
                    writer.uint32(/* id 2, wireType 2 =*/18).bytes(message.hash);
                if (message.txid != null && Object.hasOwnProperty.call(message, "txid"))
                    writer.uint32(/* id 3, wireType 0 =*/24).bool(message.txid);
                if (message.duplicate != null && Object.hasOwnProperty.call(message, "duplicate"))
                    writer.uint32(/* id 4, wireType 0 =*/32).bool(message.duplicate);
                return writer;
            };

            /**
             * Encodes the specified PathElement message, length delimited. Does not implicitly {@link onesat.beef.PathElement.verify|verify} messages.
             * @function encodeDelimited
             * @memberof onesat.beef.PathElement
             * @static
             * @param {onesat.beef.IPathElement} message PathElement message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            PathElement.encodeDelimited = function encodeDelimited(message, writer) {
                return this.encode(message, writer).ldelim();
            };

            /**
             * Decodes a PathElement message from the specified reader or buffer.
             * @function decode
             * @memberof onesat.beef.PathElement
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {onesat.beef.PathElement} PathElement
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            PathElement.decode = function decode(reader, length, error) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.onesat.beef.PathElement();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.offset = reader.uint64();
                            break;
                        }
                    case 2: {
                            message.hash = reader.bytes();
                            break;
                        }
                    case 3: {
                            message.txid = reader.bool();
                            break;
                        }
                    case 4: {
                            message.duplicate = reader.bool();
                            break;
                        }
                    default:
                        reader.skipType(tag & 7);
                        break;
                    }
                }
                return message;
            };

            /**
             * Decodes a PathElement message from the specified reader or buffer, length delimited.
             * @function decodeDelimited
             * @memberof onesat.beef.PathElement
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @returns {onesat.beef.PathElement} PathElement
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            PathElement.decodeDelimited = function decodeDelimited(reader) {
                if (!(reader instanceof $Reader))
                    reader = new $Reader(reader);
                return this.decode(reader, reader.uint32());
            };

            /**
             * Verifies a PathElement message.
             * @function verify
             * @memberof onesat.beef.PathElement
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            PathElement.verify = function verify(message) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (message.offset != null && message.hasOwnProperty("offset"))
                    if (!$util.isInteger(message.offset) && !(message.offset && $util.isInteger(message.offset.low) && $util.isInteger(message.offset.high)))
                        return "offset: integer|Long expected";
                if (message.hash != null && message.hasOwnProperty("hash"))
                    if (!(message.hash && typeof message.hash.length === "number" || $util.isString(message.hash)))
                        return "hash: buffer expected";
                if (message.txid != null && message.hasOwnProperty("txid"))
                    if (typeof message.txid !== "boolean")
                        return "txid: boolean expected";
                if (message.duplicate != null && message.hasOwnProperty("duplicate"))
                    if (typeof message.duplicate !== "boolean")
                        return "duplicate: boolean expected";
                return null;
            };

            /**
             * Creates a PathElement message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof onesat.beef.PathElement
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {onesat.beef.PathElement} PathElement
             */
            PathElement.fromObject = function fromObject(object) {
                if (object instanceof $root.onesat.beef.PathElement)
                    return object;
                let message = new $root.onesat.beef.PathElement();
                if (object.offset != null)
                    if ($util.Long)
                        (message.offset = $util.Long.fromValue(object.offset)).unsigned = true;
                    else if (typeof object.offset === "string")
                        message.offset = parseInt(object.offset, 10);
                    else if (typeof object.offset === "number")
                        message.offset = object.offset;
                    else if (typeof object.offset === "object")
                        message.offset = new $util.LongBits(object.offset.low >>> 0, object.offset.high >>> 0).toNumber(true);
                if (object.hash != null)
                    if (typeof object.hash === "string")
                        $util.base64.decode(object.hash, message.hash = $util.newBuffer($util.base64.length(object.hash)), 0);
                    else if (object.hash.length >= 0)
                        message.hash = object.hash;
                if (object.txid != null)
                    message.txid = Boolean(object.txid);
                if (object.duplicate != null)
                    message.duplicate = Boolean(object.duplicate);
                return message;
            };

            /**
             * Creates a plain object from a PathElement message. Also converts values to other types if specified.
             * @function toObject
             * @memberof onesat.beef.PathElement
             * @static
             * @param {onesat.beef.PathElement} message PathElement
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            PathElement.toObject = function toObject(message, options) {
                if (!options)
                    options = {};
                let object = {};
                if (options.defaults) {
                    if ($util.Long) {
                        let long = new $util.Long(0, 0, true);
                        object.offset = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                    } else
                        object.offset = options.longs === String ? "0" : 0;
                    if (options.bytes === String)
                        object.hash = "";
                    else {
                        object.hash = [];
                        if (options.bytes !== Array)
                            object.hash = $util.newBuffer(object.hash);
                    }
                    object.txid = false;
                    object.duplicate = false;
                }
                if (message.offset != null && message.hasOwnProperty("offset"))
                    if (typeof message.offset === "number")
                        object.offset = options.longs === String ? String(message.offset) : message.offset;
                    else
                        object.offset = options.longs === String ? $util.Long.prototype.toString.call(message.offset) : options.longs === Number ? new $util.LongBits(message.offset.low >>> 0, message.offset.high >>> 0).toNumber(true) : message.offset;
                if (message.hash != null && message.hasOwnProperty("hash"))
                    object.hash = options.bytes === String ? $util.base64.encode(message.hash, 0, message.hash.length) : options.bytes === Array ? Array.prototype.slice.call(message.hash) : message.hash;
                if (message.txid != null && message.hasOwnProperty("txid"))
                    object.txid = message.txid;
                if (message.duplicate != null && message.hasOwnProperty("duplicate"))
                    object.duplicate = message.duplicate;
                return object;
            };

            /**
             * Converts this PathElement to JSON.
             * @function toJSON
             * @memberof onesat.beef.PathElement
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            PathElement.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for PathElement
             * @function getTypeUrl
             * @memberof onesat.beef.PathElement
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            PathElement.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/onesat.beef.PathElement";
            };

            return PathElement;
        })();

        return beef;
    })();

    onesat.parse = (function() {

        /**
         * Namespace parse.
         * @memberof onesat
         * @namespace
         */
        const parse = {};

        parse.OutPoint = (function() {

            /**
             * Properties of an OutPoint.
             * @memberof onesat.parse
             * @interface IOutPoint
             * @property {Uint8Array|null} [txid] OutPoint txid
             * @property {number|null} [index] OutPoint index
             */

            /**
             * Constructs a new OutPoint.
             * @memberof onesat.parse
             * @classdesc Represents an OutPoint.
             * @implements IOutPoint
             * @constructor
             * @param {onesat.parse.IOutPoint=} [properties] Properties to set
             */
            function OutPoint(properties) {
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null)
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * OutPoint txid.
             * @member {Uint8Array} txid
             * @memberof onesat.parse.OutPoint
             * @instance
             */
            OutPoint.prototype.txid = $util.newBuffer([]);

            /**
             * OutPoint index.
             * @member {number} index
             * @memberof onesat.parse.OutPoint
             * @instance
             */
            OutPoint.prototype.index = 0;

            /**
             * Creates a new OutPoint instance using the specified properties.
             * @function create
             * @memberof onesat.parse.OutPoint
             * @static
             * @param {onesat.parse.IOutPoint=} [properties] Properties to set
             * @returns {onesat.parse.OutPoint} OutPoint instance
             */
            OutPoint.create = function create(properties) {
                return new OutPoint(properties);
            };

            /**
             * Encodes the specified OutPoint message. Does not implicitly {@link onesat.parse.OutPoint.verify|verify} messages.
             * @function encode
             * @memberof onesat.parse.OutPoint
             * @static
             * @param {onesat.parse.IOutPoint} message OutPoint message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            OutPoint.encode = function encode(message, writer) {
                if (!writer)
                    writer = $Writer.create();
                if (message.txid != null && Object.hasOwnProperty.call(message, "txid"))
                    writer.uint32(/* id 1, wireType 2 =*/10).bytes(message.txid);
                if (message.index != null && Object.hasOwnProperty.call(message, "index"))
                    writer.uint32(/* id 2, wireType 0 =*/16).uint32(message.index);
                return writer;
            };

            /**
             * Encodes the specified OutPoint message, length delimited. Does not implicitly {@link onesat.parse.OutPoint.verify|verify} messages.
             * @function encodeDelimited
             * @memberof onesat.parse.OutPoint
             * @static
             * @param {onesat.parse.IOutPoint} message OutPoint message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            OutPoint.encodeDelimited = function encodeDelimited(message, writer) {
                return this.encode(message, writer).ldelim();
            };

            /**
             * Decodes an OutPoint message from the specified reader or buffer.
             * @function decode
             * @memberof onesat.parse.OutPoint
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {onesat.parse.OutPoint} OutPoint
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            OutPoint.decode = function decode(reader, length, error) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.onesat.parse.OutPoint();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.txid = reader.bytes();
                            break;
                        }
                    case 2: {
                            message.index = reader.uint32();
                            break;
                        }
                    default:
                        reader.skipType(tag & 7);
                        break;
                    }
                }
                return message;
            };

            /**
             * Decodes an OutPoint message from the specified reader or buffer, length delimited.
             * @function decodeDelimited
             * @memberof onesat.parse.OutPoint
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @returns {onesat.parse.OutPoint} OutPoint
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            OutPoint.decodeDelimited = function decodeDelimited(reader) {
                if (!(reader instanceof $Reader))
                    reader = new $Reader(reader);
                return this.decode(reader, reader.uint32());
            };

            /**
             * Verifies an OutPoint message.
             * @function verify
             * @memberof onesat.parse.OutPoint
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            OutPoint.verify = function verify(message) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (message.txid != null && message.hasOwnProperty("txid"))
                    if (!(message.txid && typeof message.txid.length === "number" || $util.isString(message.txid)))
                        return "txid: buffer expected";
                if (message.index != null && message.hasOwnProperty("index"))
                    if (!$util.isInteger(message.index))
                        return "index: integer expected";
                return null;
            };

            /**
             * Creates an OutPoint message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof onesat.parse.OutPoint
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {onesat.parse.OutPoint} OutPoint
             */
            OutPoint.fromObject = function fromObject(object) {
                if (object instanceof $root.onesat.parse.OutPoint)
                    return object;
                let message = new $root.onesat.parse.OutPoint();
                if (object.txid != null)
                    if (typeof object.txid === "string")
                        $util.base64.decode(object.txid, message.txid = $util.newBuffer($util.base64.length(object.txid)), 0);
                    else if (object.txid.length >= 0)
                        message.txid = object.txid;
                if (object.index != null)
                    message.index = object.index >>> 0;
                return message;
            };

            /**
             * Creates a plain object from an OutPoint message. Also converts values to other types if specified.
             * @function toObject
             * @memberof onesat.parse.OutPoint
             * @static
             * @param {onesat.parse.OutPoint} message OutPoint
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            OutPoint.toObject = function toObject(message, options) {
                if (!options)
                    options = {};
                let object = {};
                if (options.defaults) {
                    if (options.bytes === String)
                        object.txid = "";
                    else {
                        object.txid = [];
                        if (options.bytes !== Array)
                            object.txid = $util.newBuffer(object.txid);
                    }
                    object.index = 0;
                }
                if (message.txid != null && message.hasOwnProperty("txid"))
                    object.txid = options.bytes === String ? $util.base64.encode(message.txid, 0, message.txid.length) : options.bytes === Array ? Array.prototype.slice.call(message.txid) : message.txid;
                if (message.index != null && message.hasOwnProperty("index"))
                    object.index = message.index;
                return object;
            };

            /**
             * Converts this OutPoint to JSON.
             * @function toJSON
             * @memberof onesat.parse.OutPoint
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            OutPoint.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for OutPoint
             * @function getTypeUrl
             * @memberof onesat.parse.OutPoint
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            OutPoint.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/onesat.parse.OutPoint";
            };

            return OutPoint;
        })();

        parse.IndexedOutput = (function() {

            /**
             * Properties of an IndexedOutput.
             * @memberof onesat.parse
             * @interface IIndexedOutput
             * @property {onesat.parse.IOutPoint|null} [outpoint] IndexedOutput outpoint
             * @property {number|Long|null} [satoshis] IndexedOutput satoshis
             * @property {number|null} [blockHeight] IndexedOutput blockHeight
             * @property {number|Long|null} [blockIdx] IndexedOutput blockIdx
             * @property {Array.<string>|null} [events] IndexedOutput events
             * @property {Array.<Uint8Array>|null} [owners] IndexedOutput owners
             * @property {Uint8Array|null} [spendTxid] IndexedOutput spendTxid
             * @property {Object.<string,Uint8Array>|null} [data] IndexedOutput data
             */

            /**
             * Constructs a new IndexedOutput.
             * @memberof onesat.parse
             * @classdesc Represents an IndexedOutput.
             * @implements IIndexedOutput
             * @constructor
             * @param {onesat.parse.IIndexedOutput=} [properties] Properties to set
             */
            function IndexedOutput(properties) {
                this.events = [];
                this.owners = [];
                this.data = {};
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null)
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * IndexedOutput outpoint.
             * @member {onesat.parse.IOutPoint|null|undefined} outpoint
             * @memberof onesat.parse.IndexedOutput
             * @instance
             */
            IndexedOutput.prototype.outpoint = null;

            /**
             * IndexedOutput satoshis.
             * @member {number|Long} satoshis
             * @memberof onesat.parse.IndexedOutput
             * @instance
             */
            IndexedOutput.prototype.satoshis = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

            /**
             * IndexedOutput blockHeight.
             * @member {number} blockHeight
             * @memberof onesat.parse.IndexedOutput
             * @instance
             */
            IndexedOutput.prototype.blockHeight = 0;

            /**
             * IndexedOutput blockIdx.
             * @member {number|Long} blockIdx
             * @memberof onesat.parse.IndexedOutput
             * @instance
             */
            IndexedOutput.prototype.blockIdx = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

            /**
             * IndexedOutput events.
             * @member {Array.<string>} events
             * @memberof onesat.parse.IndexedOutput
             * @instance
             */
            IndexedOutput.prototype.events = $util.emptyArray;

            /**
             * IndexedOutput owners.
             * @member {Array.<Uint8Array>} owners
             * @memberof onesat.parse.IndexedOutput
             * @instance
             */
            IndexedOutput.prototype.owners = $util.emptyArray;

            /**
             * IndexedOutput spendTxid.
             * @member {Uint8Array} spendTxid
             * @memberof onesat.parse.IndexedOutput
             * @instance
             */
            IndexedOutput.prototype.spendTxid = $util.newBuffer([]);

            /**
             * IndexedOutput data.
             * @member {Object.<string,Uint8Array>} data
             * @memberof onesat.parse.IndexedOutput
             * @instance
             */
            IndexedOutput.prototype.data = $util.emptyObject;

            /**
             * Creates a new IndexedOutput instance using the specified properties.
             * @function create
             * @memberof onesat.parse.IndexedOutput
             * @static
             * @param {onesat.parse.IIndexedOutput=} [properties] Properties to set
             * @returns {onesat.parse.IndexedOutput} IndexedOutput instance
             */
            IndexedOutput.create = function create(properties) {
                return new IndexedOutput(properties);
            };

            /**
             * Encodes the specified IndexedOutput message. Does not implicitly {@link onesat.parse.IndexedOutput.verify|verify} messages.
             * @function encode
             * @memberof onesat.parse.IndexedOutput
             * @static
             * @param {onesat.parse.IIndexedOutput} message IndexedOutput message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            IndexedOutput.encode = function encode(message, writer) {
                if (!writer)
                    writer = $Writer.create();
                if (message.outpoint != null && Object.hasOwnProperty.call(message, "outpoint"))
                    $root.onesat.parse.OutPoint.encode(message.outpoint, writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
                if (message.satoshis != null && Object.hasOwnProperty.call(message, "satoshis"))
                    writer.uint32(/* id 2, wireType 0 =*/16).uint64(message.satoshis);
                if (message.blockHeight != null && Object.hasOwnProperty.call(message, "blockHeight"))
                    writer.uint32(/* id 3, wireType 0 =*/24).uint32(message.blockHeight);
                if (message.blockIdx != null && Object.hasOwnProperty.call(message, "blockIdx"))
                    writer.uint32(/* id 4, wireType 0 =*/32).uint64(message.blockIdx);
                if (message.events != null && message.events.length)
                    for (let i = 0; i < message.events.length; ++i)
                        writer.uint32(/* id 5, wireType 2 =*/42).string(message.events[i]);
                if (message.owners != null && message.owners.length)
                    for (let i = 0; i < message.owners.length; ++i)
                        writer.uint32(/* id 6, wireType 2 =*/50).bytes(message.owners[i]);
                if (message.spendTxid != null && Object.hasOwnProperty.call(message, "spendTxid"))
                    writer.uint32(/* id 7, wireType 2 =*/58).bytes(message.spendTxid);
                if (message.data != null && Object.hasOwnProperty.call(message, "data"))
                    for (let keys = Object.keys(message.data), i = 0; i < keys.length; ++i)
                        writer.uint32(/* id 8, wireType 2 =*/66).fork().uint32(/* id 1, wireType 2 =*/10).string(keys[i]).uint32(/* id 2, wireType 2 =*/18).bytes(message.data[keys[i]]).ldelim();
                return writer;
            };

            /**
             * Encodes the specified IndexedOutput message, length delimited. Does not implicitly {@link onesat.parse.IndexedOutput.verify|verify} messages.
             * @function encodeDelimited
             * @memberof onesat.parse.IndexedOutput
             * @static
             * @param {onesat.parse.IIndexedOutput} message IndexedOutput message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            IndexedOutput.encodeDelimited = function encodeDelimited(message, writer) {
                return this.encode(message, writer).ldelim();
            };

            /**
             * Decodes an IndexedOutput message from the specified reader or buffer.
             * @function decode
             * @memberof onesat.parse.IndexedOutput
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {onesat.parse.IndexedOutput} IndexedOutput
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            IndexedOutput.decode = function decode(reader, length, error) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.onesat.parse.IndexedOutput(), key, value;
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            message.outpoint = $root.onesat.parse.OutPoint.decode(reader, reader.uint32());
                            break;
                        }
                    case 2: {
                            message.satoshis = reader.uint64();
                            break;
                        }
                    case 3: {
                            message.blockHeight = reader.uint32();
                            break;
                        }
                    case 4: {
                            message.blockIdx = reader.uint64();
                            break;
                        }
                    case 5: {
                            if (!(message.events && message.events.length))
                                message.events = [];
                            message.events.push(reader.string());
                            break;
                        }
                    case 6: {
                            if (!(message.owners && message.owners.length))
                                message.owners = [];
                            message.owners.push(reader.bytes());
                            break;
                        }
                    case 7: {
                            message.spendTxid = reader.bytes();
                            break;
                        }
                    case 8: {
                            if (message.data === $util.emptyObject)
                                message.data = {};
                            let end2 = reader.uint32() + reader.pos;
                            key = "";
                            value = [];
                            while (reader.pos < end2) {
                                let tag2 = reader.uint32();
                                switch (tag2 >>> 3) {
                                case 1:
                                    key = reader.string();
                                    break;
                                case 2:
                                    value = reader.bytes();
                                    break;
                                default:
                                    reader.skipType(tag2 & 7);
                                    break;
                                }
                            }
                            message.data[key] = value;
                            break;
                        }
                    default:
                        reader.skipType(tag & 7);
                        break;
                    }
                }
                return message;
            };

            /**
             * Decodes an IndexedOutput message from the specified reader or buffer, length delimited.
             * @function decodeDelimited
             * @memberof onesat.parse.IndexedOutput
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @returns {onesat.parse.IndexedOutput} IndexedOutput
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            IndexedOutput.decodeDelimited = function decodeDelimited(reader) {
                if (!(reader instanceof $Reader))
                    reader = new $Reader(reader);
                return this.decode(reader, reader.uint32());
            };

            /**
             * Verifies an IndexedOutput message.
             * @function verify
             * @memberof onesat.parse.IndexedOutput
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            IndexedOutput.verify = function verify(message) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (message.outpoint != null && message.hasOwnProperty("outpoint")) {
                    let error = $root.onesat.parse.OutPoint.verify(message.outpoint);
                    if (error)
                        return "outpoint." + error;
                }
                if (message.satoshis != null && message.hasOwnProperty("satoshis"))
                    if (!$util.isInteger(message.satoshis) && !(message.satoshis && $util.isInteger(message.satoshis.low) && $util.isInteger(message.satoshis.high)))
                        return "satoshis: integer|Long expected";
                if (message.blockHeight != null && message.hasOwnProperty("blockHeight"))
                    if (!$util.isInteger(message.blockHeight))
                        return "blockHeight: integer expected";
                if (message.blockIdx != null && message.hasOwnProperty("blockIdx"))
                    if (!$util.isInteger(message.blockIdx) && !(message.blockIdx && $util.isInteger(message.blockIdx.low) && $util.isInteger(message.blockIdx.high)))
                        return "blockIdx: integer|Long expected";
                if (message.events != null && message.hasOwnProperty("events")) {
                    if (!Array.isArray(message.events))
                        return "events: array expected";
                    for (let i = 0; i < message.events.length; ++i)
                        if (!$util.isString(message.events[i]))
                            return "events: string[] expected";
                }
                if (message.owners != null && message.hasOwnProperty("owners")) {
                    if (!Array.isArray(message.owners))
                        return "owners: array expected";
                    for (let i = 0; i < message.owners.length; ++i)
                        if (!(message.owners[i] && typeof message.owners[i].length === "number" || $util.isString(message.owners[i])))
                            return "owners: buffer[] expected";
                }
                if (message.spendTxid != null && message.hasOwnProperty("spendTxid"))
                    if (!(message.spendTxid && typeof message.spendTxid.length === "number" || $util.isString(message.spendTxid)))
                        return "spendTxid: buffer expected";
                if (message.data != null && message.hasOwnProperty("data")) {
                    if (!$util.isObject(message.data))
                        return "data: object expected";
                    let key = Object.keys(message.data);
                    for (let i = 0; i < key.length; ++i)
                        if (!(message.data[key[i]] && typeof message.data[key[i]].length === "number" || $util.isString(message.data[key[i]])))
                            return "data: buffer{k:string} expected";
                }
                return null;
            };

            /**
             * Creates an IndexedOutput message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof onesat.parse.IndexedOutput
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {onesat.parse.IndexedOutput} IndexedOutput
             */
            IndexedOutput.fromObject = function fromObject(object) {
                if (object instanceof $root.onesat.parse.IndexedOutput)
                    return object;
                let message = new $root.onesat.parse.IndexedOutput();
                if (object.outpoint != null) {
                    if (typeof object.outpoint !== "object")
                        throw TypeError(".onesat.parse.IndexedOutput.outpoint: object expected");
                    message.outpoint = $root.onesat.parse.OutPoint.fromObject(object.outpoint);
                }
                if (object.satoshis != null)
                    if ($util.Long)
                        (message.satoshis = $util.Long.fromValue(object.satoshis)).unsigned = true;
                    else if (typeof object.satoshis === "string")
                        message.satoshis = parseInt(object.satoshis, 10);
                    else if (typeof object.satoshis === "number")
                        message.satoshis = object.satoshis;
                    else if (typeof object.satoshis === "object")
                        message.satoshis = new $util.LongBits(object.satoshis.low >>> 0, object.satoshis.high >>> 0).toNumber(true);
                if (object.blockHeight != null)
                    message.blockHeight = object.blockHeight >>> 0;
                if (object.blockIdx != null)
                    if ($util.Long)
                        (message.blockIdx = $util.Long.fromValue(object.blockIdx)).unsigned = true;
                    else if (typeof object.blockIdx === "string")
                        message.blockIdx = parseInt(object.blockIdx, 10);
                    else if (typeof object.blockIdx === "number")
                        message.blockIdx = object.blockIdx;
                    else if (typeof object.blockIdx === "object")
                        message.blockIdx = new $util.LongBits(object.blockIdx.low >>> 0, object.blockIdx.high >>> 0).toNumber(true);
                if (object.events) {
                    if (!Array.isArray(object.events))
                        throw TypeError(".onesat.parse.IndexedOutput.events: array expected");
                    message.events = [];
                    for (let i = 0; i < object.events.length; ++i)
                        message.events[i] = String(object.events[i]);
                }
                if (object.owners) {
                    if (!Array.isArray(object.owners))
                        throw TypeError(".onesat.parse.IndexedOutput.owners: array expected");
                    message.owners = [];
                    for (let i = 0; i < object.owners.length; ++i)
                        if (typeof object.owners[i] === "string")
                            $util.base64.decode(object.owners[i], message.owners[i] = $util.newBuffer($util.base64.length(object.owners[i])), 0);
                        else if (object.owners[i].length >= 0)
                            message.owners[i] = object.owners[i];
                }
                if (object.spendTxid != null)
                    if (typeof object.spendTxid === "string")
                        $util.base64.decode(object.spendTxid, message.spendTxid = $util.newBuffer($util.base64.length(object.spendTxid)), 0);
                    else if (object.spendTxid.length >= 0)
                        message.spendTxid = object.spendTxid;
                if (object.data) {
                    if (typeof object.data !== "object")
                        throw TypeError(".onesat.parse.IndexedOutput.data: object expected");
                    message.data = {};
                    for (let keys = Object.keys(object.data), i = 0; i < keys.length; ++i)
                        if (typeof object.data[keys[i]] === "string")
                            $util.base64.decode(object.data[keys[i]], message.data[keys[i]] = $util.newBuffer($util.base64.length(object.data[keys[i]])), 0);
                        else if (object.data[keys[i]].length >= 0)
                            message.data[keys[i]] = object.data[keys[i]];
                }
                return message;
            };

            /**
             * Creates a plain object from an IndexedOutput message. Also converts values to other types if specified.
             * @function toObject
             * @memberof onesat.parse.IndexedOutput
             * @static
             * @param {onesat.parse.IndexedOutput} message IndexedOutput
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            IndexedOutput.toObject = function toObject(message, options) {
                if (!options)
                    options = {};
                let object = {};
                if (options.arrays || options.defaults) {
                    object.events = [];
                    object.owners = [];
                }
                if (options.objects || options.defaults)
                    object.data = {};
                if (options.defaults) {
                    object.outpoint = null;
                    if ($util.Long) {
                        let long = new $util.Long(0, 0, true);
                        object.satoshis = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                    } else
                        object.satoshis = options.longs === String ? "0" : 0;
                    object.blockHeight = 0;
                    if ($util.Long) {
                        let long = new $util.Long(0, 0, true);
                        object.blockIdx = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                    } else
                        object.blockIdx = options.longs === String ? "0" : 0;
                    if (options.bytes === String)
                        object.spendTxid = "";
                    else {
                        object.spendTxid = [];
                        if (options.bytes !== Array)
                            object.spendTxid = $util.newBuffer(object.spendTxid);
                    }
                }
                if (message.outpoint != null && message.hasOwnProperty("outpoint"))
                    object.outpoint = $root.onesat.parse.OutPoint.toObject(message.outpoint, options);
                if (message.satoshis != null && message.hasOwnProperty("satoshis"))
                    if (typeof message.satoshis === "number")
                        object.satoshis = options.longs === String ? String(message.satoshis) : message.satoshis;
                    else
                        object.satoshis = options.longs === String ? $util.Long.prototype.toString.call(message.satoshis) : options.longs === Number ? new $util.LongBits(message.satoshis.low >>> 0, message.satoshis.high >>> 0).toNumber(true) : message.satoshis;
                if (message.blockHeight != null && message.hasOwnProperty("blockHeight"))
                    object.blockHeight = message.blockHeight;
                if (message.blockIdx != null && message.hasOwnProperty("blockIdx"))
                    if (typeof message.blockIdx === "number")
                        object.blockIdx = options.longs === String ? String(message.blockIdx) : message.blockIdx;
                    else
                        object.blockIdx = options.longs === String ? $util.Long.prototype.toString.call(message.blockIdx) : options.longs === Number ? new $util.LongBits(message.blockIdx.low >>> 0, message.blockIdx.high >>> 0).toNumber(true) : message.blockIdx;
                if (message.events && message.events.length) {
                    object.events = [];
                    for (let j = 0; j < message.events.length; ++j)
                        object.events[j] = message.events[j];
                }
                if (message.owners && message.owners.length) {
                    object.owners = [];
                    for (let j = 0; j < message.owners.length; ++j)
                        object.owners[j] = options.bytes === String ? $util.base64.encode(message.owners[j], 0, message.owners[j].length) : options.bytes === Array ? Array.prototype.slice.call(message.owners[j]) : message.owners[j];
                }
                if (message.spendTxid != null && message.hasOwnProperty("spendTxid"))
                    object.spendTxid = options.bytes === String ? $util.base64.encode(message.spendTxid, 0, message.spendTxid.length) : options.bytes === Array ? Array.prototype.slice.call(message.spendTxid) : message.spendTxid;
                let keys2;
                if (message.data && (keys2 = Object.keys(message.data)).length) {
                    object.data = {};
                    for (let j = 0; j < keys2.length; ++j)
                        object.data[keys2[j]] = options.bytes === String ? $util.base64.encode(message.data[keys2[j]], 0, message.data[keys2[j]].length) : options.bytes === Array ? Array.prototype.slice.call(message.data[keys2[j]]) : message.data[keys2[j]];
                }
                return object;
            };

            /**
             * Converts this IndexedOutput to JSON.
             * @function toJSON
             * @memberof onesat.parse.IndexedOutput
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            IndexedOutput.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for IndexedOutput
             * @function getTypeUrl
             * @memberof onesat.parse.IndexedOutput
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            IndexedOutput.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/onesat.parse.IndexedOutput";
            };

            return IndexedOutput;
        })();

        parse.BeefParseResult = (function() {

            /**
             * Properties of a BeefParseResult.
             * @memberof onesat.parse
             * @interface IBeefParseResult
             * @property {Array.<onesat.parse.IIndexedOutput>|null} [outputs] BeefParseResult outputs
             * @property {Array.<onesat.parse.IIndexedOutput>|null} [spends] BeefParseResult spends
             * @property {Uint8Array|null} [txid] BeefParseResult txid
             * @property {number|null} [blockHeight] BeefParseResult blockHeight
             * @property {number|Long|null} [blockIdx] BeefParseResult blockIdx
             */

            /**
             * Constructs a new BeefParseResult.
             * @memberof onesat.parse
             * @classdesc Represents a BeefParseResult.
             * @implements IBeefParseResult
             * @constructor
             * @param {onesat.parse.IBeefParseResult=} [properties] Properties to set
             */
            function BeefParseResult(properties) {
                this.outputs = [];
                this.spends = [];
                if (properties)
                    for (let keys = Object.keys(properties), i = 0; i < keys.length; ++i)
                        if (properties[keys[i]] != null)
                            this[keys[i]] = properties[keys[i]];
            }

            /**
             * BeefParseResult outputs.
             * @member {Array.<onesat.parse.IIndexedOutput>} outputs
             * @memberof onesat.parse.BeefParseResult
             * @instance
             */
            BeefParseResult.prototype.outputs = $util.emptyArray;

            /**
             * BeefParseResult spends.
             * @member {Array.<onesat.parse.IIndexedOutput>} spends
             * @memberof onesat.parse.BeefParseResult
             * @instance
             */
            BeefParseResult.prototype.spends = $util.emptyArray;

            /**
             * BeefParseResult txid.
             * @member {Uint8Array} txid
             * @memberof onesat.parse.BeefParseResult
             * @instance
             */
            BeefParseResult.prototype.txid = $util.newBuffer([]);

            /**
             * BeefParseResult blockHeight.
             * @member {number} blockHeight
             * @memberof onesat.parse.BeefParseResult
             * @instance
             */
            BeefParseResult.prototype.blockHeight = 0;

            /**
             * BeefParseResult blockIdx.
             * @member {number|Long} blockIdx
             * @memberof onesat.parse.BeefParseResult
             * @instance
             */
            BeefParseResult.prototype.blockIdx = $util.Long ? $util.Long.fromBits(0,0,true) : 0;

            /**
             * Creates a new BeefParseResult instance using the specified properties.
             * @function create
             * @memberof onesat.parse.BeefParseResult
             * @static
             * @param {onesat.parse.IBeefParseResult=} [properties] Properties to set
             * @returns {onesat.parse.BeefParseResult} BeefParseResult instance
             */
            BeefParseResult.create = function create(properties) {
                return new BeefParseResult(properties);
            };

            /**
             * Encodes the specified BeefParseResult message. Does not implicitly {@link onesat.parse.BeefParseResult.verify|verify} messages.
             * @function encode
             * @memberof onesat.parse.BeefParseResult
             * @static
             * @param {onesat.parse.IBeefParseResult} message BeefParseResult message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            BeefParseResult.encode = function encode(message, writer) {
                if (!writer)
                    writer = $Writer.create();
                if (message.outputs != null && message.outputs.length)
                    for (let i = 0; i < message.outputs.length; ++i)
                        $root.onesat.parse.IndexedOutput.encode(message.outputs[i], writer.uint32(/* id 1, wireType 2 =*/10).fork()).ldelim();
                if (message.spends != null && message.spends.length)
                    for (let i = 0; i < message.spends.length; ++i)
                        $root.onesat.parse.IndexedOutput.encode(message.spends[i], writer.uint32(/* id 2, wireType 2 =*/18).fork()).ldelim();
                if (message.txid != null && Object.hasOwnProperty.call(message, "txid"))
                    writer.uint32(/* id 3, wireType 2 =*/26).bytes(message.txid);
                if (message.blockHeight != null && Object.hasOwnProperty.call(message, "blockHeight"))
                    writer.uint32(/* id 4, wireType 0 =*/32).uint32(message.blockHeight);
                if (message.blockIdx != null && Object.hasOwnProperty.call(message, "blockIdx"))
                    writer.uint32(/* id 5, wireType 0 =*/40).uint64(message.blockIdx);
                return writer;
            };

            /**
             * Encodes the specified BeefParseResult message, length delimited. Does not implicitly {@link onesat.parse.BeefParseResult.verify|verify} messages.
             * @function encodeDelimited
             * @memberof onesat.parse.BeefParseResult
             * @static
             * @param {onesat.parse.IBeefParseResult} message BeefParseResult message or plain object to encode
             * @param {$protobuf.Writer} [writer] Writer to encode to
             * @returns {$protobuf.Writer} Writer
             */
            BeefParseResult.encodeDelimited = function encodeDelimited(message, writer) {
                return this.encode(message, writer).ldelim();
            };

            /**
             * Decodes a BeefParseResult message from the specified reader or buffer.
             * @function decode
             * @memberof onesat.parse.BeefParseResult
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @param {number} [length] Message length if known beforehand
             * @returns {onesat.parse.BeefParseResult} BeefParseResult
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            BeefParseResult.decode = function decode(reader, length, error) {
                if (!(reader instanceof $Reader))
                    reader = $Reader.create(reader);
                let end = length === undefined ? reader.len : reader.pos + length, message = new $root.onesat.parse.BeefParseResult();
                while (reader.pos < end) {
                    let tag = reader.uint32();
                    if (tag === error)
                        break;
                    switch (tag >>> 3) {
                    case 1: {
                            if (!(message.outputs && message.outputs.length))
                                message.outputs = [];
                            message.outputs.push($root.onesat.parse.IndexedOutput.decode(reader, reader.uint32()));
                            break;
                        }
                    case 2: {
                            if (!(message.spends && message.spends.length))
                                message.spends = [];
                            message.spends.push($root.onesat.parse.IndexedOutput.decode(reader, reader.uint32()));
                            break;
                        }
                    case 3: {
                            message.txid = reader.bytes();
                            break;
                        }
                    case 4: {
                            message.blockHeight = reader.uint32();
                            break;
                        }
                    case 5: {
                            message.blockIdx = reader.uint64();
                            break;
                        }
                    default:
                        reader.skipType(tag & 7);
                        break;
                    }
                }
                return message;
            };

            /**
             * Decodes a BeefParseResult message from the specified reader or buffer, length delimited.
             * @function decodeDelimited
             * @memberof onesat.parse.BeefParseResult
             * @static
             * @param {$protobuf.Reader|Uint8Array} reader Reader or buffer to decode from
             * @returns {onesat.parse.BeefParseResult} BeefParseResult
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            BeefParseResult.decodeDelimited = function decodeDelimited(reader) {
                if (!(reader instanceof $Reader))
                    reader = new $Reader(reader);
                return this.decode(reader, reader.uint32());
            };

            /**
             * Verifies a BeefParseResult message.
             * @function verify
             * @memberof onesat.parse.BeefParseResult
             * @static
             * @param {Object.<string,*>} message Plain object to verify
             * @returns {string|null} `null` if valid, otherwise the reason why it is not
             */
            BeefParseResult.verify = function verify(message) {
                if (typeof message !== "object" || message === null)
                    return "object expected";
                if (message.outputs != null && message.hasOwnProperty("outputs")) {
                    if (!Array.isArray(message.outputs))
                        return "outputs: array expected";
                    for (let i = 0; i < message.outputs.length; ++i) {
                        let error = $root.onesat.parse.IndexedOutput.verify(message.outputs[i]);
                        if (error)
                            return "outputs." + error;
                    }
                }
                if (message.spends != null && message.hasOwnProperty("spends")) {
                    if (!Array.isArray(message.spends))
                        return "spends: array expected";
                    for (let i = 0; i < message.spends.length; ++i) {
                        let error = $root.onesat.parse.IndexedOutput.verify(message.spends[i]);
                        if (error)
                            return "spends." + error;
                    }
                }
                if (message.txid != null && message.hasOwnProperty("txid"))
                    if (!(message.txid && typeof message.txid.length === "number" || $util.isString(message.txid)))
                        return "txid: buffer expected";
                if (message.blockHeight != null && message.hasOwnProperty("blockHeight"))
                    if (!$util.isInteger(message.blockHeight))
                        return "blockHeight: integer expected";
                if (message.blockIdx != null && message.hasOwnProperty("blockIdx"))
                    if (!$util.isInteger(message.blockIdx) && !(message.blockIdx && $util.isInteger(message.blockIdx.low) && $util.isInteger(message.blockIdx.high)))
                        return "blockIdx: integer|Long expected";
                return null;
            };

            /**
             * Creates a BeefParseResult message from a plain object. Also converts values to their respective internal types.
             * @function fromObject
             * @memberof onesat.parse.BeefParseResult
             * @static
             * @param {Object.<string,*>} object Plain object
             * @returns {onesat.parse.BeefParseResult} BeefParseResult
             */
            BeefParseResult.fromObject = function fromObject(object) {
                if (object instanceof $root.onesat.parse.BeefParseResult)
                    return object;
                let message = new $root.onesat.parse.BeefParseResult();
                if (object.outputs) {
                    if (!Array.isArray(object.outputs))
                        throw TypeError(".onesat.parse.BeefParseResult.outputs: array expected");
                    message.outputs = [];
                    for (let i = 0; i < object.outputs.length; ++i) {
                        if (typeof object.outputs[i] !== "object")
                            throw TypeError(".onesat.parse.BeefParseResult.outputs: object expected");
                        message.outputs[i] = $root.onesat.parse.IndexedOutput.fromObject(object.outputs[i]);
                    }
                }
                if (object.spends) {
                    if (!Array.isArray(object.spends))
                        throw TypeError(".onesat.parse.BeefParseResult.spends: array expected");
                    message.spends = [];
                    for (let i = 0; i < object.spends.length; ++i) {
                        if (typeof object.spends[i] !== "object")
                            throw TypeError(".onesat.parse.BeefParseResult.spends: object expected");
                        message.spends[i] = $root.onesat.parse.IndexedOutput.fromObject(object.spends[i]);
                    }
                }
                if (object.txid != null)
                    if (typeof object.txid === "string")
                        $util.base64.decode(object.txid, message.txid = $util.newBuffer($util.base64.length(object.txid)), 0);
                    else if (object.txid.length >= 0)
                        message.txid = object.txid;
                if (object.blockHeight != null)
                    message.blockHeight = object.blockHeight >>> 0;
                if (object.blockIdx != null)
                    if ($util.Long)
                        (message.blockIdx = $util.Long.fromValue(object.blockIdx)).unsigned = true;
                    else if (typeof object.blockIdx === "string")
                        message.blockIdx = parseInt(object.blockIdx, 10);
                    else if (typeof object.blockIdx === "number")
                        message.blockIdx = object.blockIdx;
                    else if (typeof object.blockIdx === "object")
                        message.blockIdx = new $util.LongBits(object.blockIdx.low >>> 0, object.blockIdx.high >>> 0).toNumber(true);
                return message;
            };

            /**
             * Creates a plain object from a BeefParseResult message. Also converts values to other types if specified.
             * @function toObject
             * @memberof onesat.parse.BeefParseResult
             * @static
             * @param {onesat.parse.BeefParseResult} message BeefParseResult
             * @param {$protobuf.IConversionOptions} [options] Conversion options
             * @returns {Object.<string,*>} Plain object
             */
            BeefParseResult.toObject = function toObject(message, options) {
                if (!options)
                    options = {};
                let object = {};
                if (options.arrays || options.defaults) {
                    object.outputs = [];
                    object.spends = [];
                }
                if (options.defaults) {
                    if (options.bytes === String)
                        object.txid = "";
                    else {
                        object.txid = [];
                        if (options.bytes !== Array)
                            object.txid = $util.newBuffer(object.txid);
                    }
                    object.blockHeight = 0;
                    if ($util.Long) {
                        let long = new $util.Long(0, 0, true);
                        object.blockIdx = options.longs === String ? long.toString() : options.longs === Number ? long.toNumber() : long;
                    } else
                        object.blockIdx = options.longs === String ? "0" : 0;
                }
                if (message.outputs && message.outputs.length) {
                    object.outputs = [];
                    for (let j = 0; j < message.outputs.length; ++j)
                        object.outputs[j] = $root.onesat.parse.IndexedOutput.toObject(message.outputs[j], options);
                }
                if (message.spends && message.spends.length) {
                    object.spends = [];
                    for (let j = 0; j < message.spends.length; ++j)
                        object.spends[j] = $root.onesat.parse.IndexedOutput.toObject(message.spends[j], options);
                }
                if (message.txid != null && message.hasOwnProperty("txid"))
                    object.txid = options.bytes === String ? $util.base64.encode(message.txid, 0, message.txid.length) : options.bytes === Array ? Array.prototype.slice.call(message.txid) : message.txid;
                if (message.blockHeight != null && message.hasOwnProperty("blockHeight"))
                    object.blockHeight = message.blockHeight;
                if (message.blockIdx != null && message.hasOwnProperty("blockIdx"))
                    if (typeof message.blockIdx === "number")
                        object.blockIdx = options.longs === String ? String(message.blockIdx) : message.blockIdx;
                    else
                        object.blockIdx = options.longs === String ? $util.Long.prototype.toString.call(message.blockIdx) : options.longs === Number ? new $util.LongBits(message.blockIdx.low >>> 0, message.blockIdx.high >>> 0).toNumber(true) : message.blockIdx;
                return object;
            };

            /**
             * Converts this BeefParseResult to JSON.
             * @function toJSON
             * @memberof onesat.parse.BeefParseResult
             * @instance
             * @returns {Object.<string,*>} JSON object
             */
            BeefParseResult.prototype.toJSON = function toJSON() {
                return this.constructor.toObject(this, $protobuf.util.toJSONOptions);
            };

            /**
             * Gets the default type url for BeefParseResult
             * @function getTypeUrl
             * @memberof onesat.parse.BeefParseResult
             * @static
             * @param {string} [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns {string} The default type url
             */
            BeefParseResult.getTypeUrl = function getTypeUrl(typeUrlPrefix) {
                if (typeUrlPrefix === undefined) {
                    typeUrlPrefix = "type.googleapis.com";
                }
                return typeUrlPrefix + "/onesat.parse.BeefParseResult";
            };

            return BeefParseResult;
        })();

        return parse;
    })();

    return onesat;
})();

export { $root as default };
