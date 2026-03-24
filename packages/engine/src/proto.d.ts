import * as $protobuf from "protobufjs";
import Long = require("long");
/** Namespace onesat. */
export namespace onesat {

    /** Namespace beef. */
    namespace beef {

        /** DataFormat enum. */
        enum DataFormat {
            RAW_TX = 0,
            RAW_TX_AND_BUMP_INDEX = 1,
            TXID_ONLY = 2
        }

        /** Properties of a BeefTx. */
        interface IBeefTx {

            /** BeefTx txid */
            txid?: (Uint8Array|null);

            /** BeefTx dataFormat */
            dataFormat?: (onesat.beef.DataFormat|null);

            /** BeefTx rawTx */
            rawTx?: (Uint8Array|null);

            /** BeefTx bumpIndex */
            bumpIndex?: (number|null);
        }

        /** Represents a BeefTx. */
        class BeefTx implements IBeefTx {

            /**
             * Constructs a new BeefTx.
             * @param [properties] Properties to set
             */
            constructor(properties?: onesat.beef.IBeefTx);

            /** BeefTx txid. */
            public txid: Uint8Array;

            /** BeefTx dataFormat. */
            public dataFormat: onesat.beef.DataFormat;

            /** BeefTx rawTx. */
            public rawTx: Uint8Array;

            /** BeefTx bumpIndex. */
            public bumpIndex?: (number|null);

            /**
             * Creates a new BeefTx instance using the specified properties.
             * @param [properties] Properties to set
             * @returns BeefTx instance
             */
            public static create(properties?: onesat.beef.IBeefTx): onesat.beef.BeefTx;

            /**
             * Encodes the specified BeefTx message. Does not implicitly {@link onesat.beef.BeefTx.verify|verify} messages.
             * @param message BeefTx message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: onesat.beef.IBeefTx, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified BeefTx message, length delimited. Does not implicitly {@link onesat.beef.BeefTx.verify|verify} messages.
             * @param message BeefTx message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: onesat.beef.IBeefTx, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a BeefTx message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns BeefTx
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): onesat.beef.BeefTx;

            /**
             * Decodes a BeefTx message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns BeefTx
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): onesat.beef.BeefTx;

            /**
             * Verifies a BeefTx message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a BeefTx message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns BeefTx
             */
            public static fromObject(object: { [k: string]: any }): onesat.beef.BeefTx;

            /**
             * Creates a plain object from a BeefTx message. Also converts values to other types if specified.
             * @param message BeefTx
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: onesat.beef.BeefTx, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this BeefTx to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for BeefTx
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of a Beef. */
        interface IBeef {

            /** Beef bumps */
            bumps?: (onesat.beef.IMerklePath[]|null);

            /** Beef transactions */
            transactions?: (onesat.beef.IBeefTx[]|null);
        }

        /** Represents a Beef. */
        class Beef implements IBeef {

            /**
             * Constructs a new Beef.
             * @param [properties] Properties to set
             */
            constructor(properties?: onesat.beef.IBeef);

            /** Beef bumps. */
            public bumps: onesat.beef.IMerklePath[];

            /** Beef transactions. */
            public transactions: onesat.beef.IBeefTx[];

            /**
             * Creates a new Beef instance using the specified properties.
             * @param [properties] Properties to set
             * @returns Beef instance
             */
            public static create(properties?: onesat.beef.IBeef): onesat.beef.Beef;

            /**
             * Encodes the specified Beef message. Does not implicitly {@link onesat.beef.Beef.verify|verify} messages.
             * @param message Beef message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: onesat.beef.IBeef, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified Beef message, length delimited. Does not implicitly {@link onesat.beef.Beef.verify|verify} messages.
             * @param message Beef message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: onesat.beef.IBeef, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a Beef message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns Beef
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): onesat.beef.Beef;

            /**
             * Decodes a Beef message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns Beef
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): onesat.beef.Beef;

            /**
             * Verifies a Beef message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a Beef message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns Beef
             */
            public static fromObject(object: { [k: string]: any }): onesat.beef.Beef;

            /**
             * Creates a plain object from a Beef message. Also converts values to other types if specified.
             * @param message Beef
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: onesat.beef.Beef, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this Beef to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for Beef
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of an AtomicBeef. */
        interface IAtomicBeef {

            /** AtomicBeef txid */
            txid?: (Uint8Array|null);

            /** AtomicBeef beef */
            beef?: (onesat.beef.IBeef|null);
        }

        /** Represents an AtomicBeef. */
        class AtomicBeef implements IAtomicBeef {

            /**
             * Constructs a new AtomicBeef.
             * @param [properties] Properties to set
             */
            constructor(properties?: onesat.beef.IAtomicBeef);

            /** AtomicBeef txid. */
            public txid: Uint8Array;

            /** AtomicBeef beef. */
            public beef?: (onesat.beef.IBeef|null);

            /**
             * Creates a new AtomicBeef instance using the specified properties.
             * @param [properties] Properties to set
             * @returns AtomicBeef instance
             */
            public static create(properties?: onesat.beef.IAtomicBeef): onesat.beef.AtomicBeef;

            /**
             * Encodes the specified AtomicBeef message. Does not implicitly {@link onesat.beef.AtomicBeef.verify|verify} messages.
             * @param message AtomicBeef message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: onesat.beef.IAtomicBeef, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified AtomicBeef message, length delimited. Does not implicitly {@link onesat.beef.AtomicBeef.verify|verify} messages.
             * @param message AtomicBeef message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: onesat.beef.IAtomicBeef, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes an AtomicBeef message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns AtomicBeef
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): onesat.beef.AtomicBeef;

            /**
             * Decodes an AtomicBeef message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns AtomicBeef
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): onesat.beef.AtomicBeef;

            /**
             * Verifies an AtomicBeef message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates an AtomicBeef message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns AtomicBeef
             */
            public static fromObject(object: { [k: string]: any }): onesat.beef.AtomicBeef;

            /**
             * Creates a plain object from an AtomicBeef message. Also converts values to other types if specified.
             * @param message AtomicBeef
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: onesat.beef.AtomicBeef, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this AtomicBeef to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for AtomicBeef
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of a MerklePath. */
        interface IMerklePath {

            /** MerklePath blockHeight */
            blockHeight?: (number|null);

            /** MerklePath path */
            path?: (onesat.beef.IPathLevel[]|null);
        }

        /** Represents a MerklePath. */
        class MerklePath implements IMerklePath {

            /**
             * Constructs a new MerklePath.
             * @param [properties] Properties to set
             */
            constructor(properties?: onesat.beef.IMerklePath);

            /** MerklePath blockHeight. */
            public blockHeight: number;

            /** MerklePath path. */
            public path: onesat.beef.IPathLevel[];

            /**
             * Creates a new MerklePath instance using the specified properties.
             * @param [properties] Properties to set
             * @returns MerklePath instance
             */
            public static create(properties?: onesat.beef.IMerklePath): onesat.beef.MerklePath;

            /**
             * Encodes the specified MerklePath message. Does not implicitly {@link onesat.beef.MerklePath.verify|verify} messages.
             * @param message MerklePath message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: onesat.beef.IMerklePath, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified MerklePath message, length delimited. Does not implicitly {@link onesat.beef.MerklePath.verify|verify} messages.
             * @param message MerklePath message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: onesat.beef.IMerklePath, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a MerklePath message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns MerklePath
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): onesat.beef.MerklePath;

            /**
             * Decodes a MerklePath message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns MerklePath
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): onesat.beef.MerklePath;

            /**
             * Verifies a MerklePath message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a MerklePath message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns MerklePath
             */
            public static fromObject(object: { [k: string]: any }): onesat.beef.MerklePath;

            /**
             * Creates a plain object from a MerklePath message. Also converts values to other types if specified.
             * @param message MerklePath
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: onesat.beef.MerklePath, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this MerklePath to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for MerklePath
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of a PathLevel. */
        interface IPathLevel {

            /** PathLevel elements */
            elements?: (onesat.beef.IPathElement[]|null);
        }

        /** Represents a PathLevel. */
        class PathLevel implements IPathLevel {

            /**
             * Constructs a new PathLevel.
             * @param [properties] Properties to set
             */
            constructor(properties?: onesat.beef.IPathLevel);

            /** PathLevel elements. */
            public elements: onesat.beef.IPathElement[];

            /**
             * Creates a new PathLevel instance using the specified properties.
             * @param [properties] Properties to set
             * @returns PathLevel instance
             */
            public static create(properties?: onesat.beef.IPathLevel): onesat.beef.PathLevel;

            /**
             * Encodes the specified PathLevel message. Does not implicitly {@link onesat.beef.PathLevel.verify|verify} messages.
             * @param message PathLevel message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: onesat.beef.IPathLevel, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified PathLevel message, length delimited. Does not implicitly {@link onesat.beef.PathLevel.verify|verify} messages.
             * @param message PathLevel message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: onesat.beef.IPathLevel, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a PathLevel message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns PathLevel
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): onesat.beef.PathLevel;

            /**
             * Decodes a PathLevel message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns PathLevel
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): onesat.beef.PathLevel;

            /**
             * Verifies a PathLevel message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a PathLevel message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns PathLevel
             */
            public static fromObject(object: { [k: string]: any }): onesat.beef.PathLevel;

            /**
             * Creates a plain object from a PathLevel message. Also converts values to other types if specified.
             * @param message PathLevel
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: onesat.beef.PathLevel, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this PathLevel to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for PathLevel
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of a PathElement. */
        interface IPathElement {

            /** PathElement offset */
            offset?: (number|Long|null);

            /** PathElement hash */
            hash?: (Uint8Array|null);

            /** PathElement txid */
            txid?: (boolean|null);

            /** PathElement duplicate */
            duplicate?: (boolean|null);
        }

        /** Represents a PathElement. */
        class PathElement implements IPathElement {

            /**
             * Constructs a new PathElement.
             * @param [properties] Properties to set
             */
            constructor(properties?: onesat.beef.IPathElement);

            /** PathElement offset. */
            public offset: (number|Long);

            /** PathElement hash. */
            public hash: Uint8Array;

            /** PathElement txid. */
            public txid: boolean;

            /** PathElement duplicate. */
            public duplicate: boolean;

            /**
             * Creates a new PathElement instance using the specified properties.
             * @param [properties] Properties to set
             * @returns PathElement instance
             */
            public static create(properties?: onesat.beef.IPathElement): onesat.beef.PathElement;

            /**
             * Encodes the specified PathElement message. Does not implicitly {@link onesat.beef.PathElement.verify|verify} messages.
             * @param message PathElement message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: onesat.beef.IPathElement, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified PathElement message, length delimited. Does not implicitly {@link onesat.beef.PathElement.verify|verify} messages.
             * @param message PathElement message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: onesat.beef.IPathElement, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a PathElement message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns PathElement
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): onesat.beef.PathElement;

            /**
             * Decodes a PathElement message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns PathElement
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): onesat.beef.PathElement;

            /**
             * Verifies a PathElement message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a PathElement message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns PathElement
             */
            public static fromObject(object: { [k: string]: any }): onesat.beef.PathElement;

            /**
             * Creates a plain object from a PathElement message. Also converts values to other types if specified.
             * @param message PathElement
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: onesat.beef.PathElement, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this PathElement to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for PathElement
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }
    }

    /** Namespace parse. */
    namespace parse {

        /** Properties of an OutPoint. */
        interface IOutPoint {

            /** OutPoint txid */
            txid?: (Uint8Array|null);

            /** OutPoint index */
            index?: (number|null);
        }

        /** Represents an OutPoint. */
        class OutPoint implements IOutPoint {

            /**
             * Constructs a new OutPoint.
             * @param [properties] Properties to set
             */
            constructor(properties?: onesat.parse.IOutPoint);

            /** OutPoint txid. */
            public txid: Uint8Array;

            /** OutPoint index. */
            public index: number;

            /**
             * Creates a new OutPoint instance using the specified properties.
             * @param [properties] Properties to set
             * @returns OutPoint instance
             */
            public static create(properties?: onesat.parse.IOutPoint): onesat.parse.OutPoint;

            /**
             * Encodes the specified OutPoint message. Does not implicitly {@link onesat.parse.OutPoint.verify|verify} messages.
             * @param message OutPoint message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: onesat.parse.IOutPoint, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified OutPoint message, length delimited. Does not implicitly {@link onesat.parse.OutPoint.verify|verify} messages.
             * @param message OutPoint message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: onesat.parse.IOutPoint, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes an OutPoint message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns OutPoint
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): onesat.parse.OutPoint;

            /**
             * Decodes an OutPoint message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns OutPoint
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): onesat.parse.OutPoint;

            /**
             * Verifies an OutPoint message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates an OutPoint message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns OutPoint
             */
            public static fromObject(object: { [k: string]: any }): onesat.parse.OutPoint;

            /**
             * Creates a plain object from an OutPoint message. Also converts values to other types if specified.
             * @param message OutPoint
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: onesat.parse.OutPoint, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this OutPoint to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for OutPoint
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of an IndexedOutput. */
        interface IIndexedOutput {

            /** IndexedOutput outpoint */
            outpoint?: (onesat.parse.IOutPoint|null);

            /** IndexedOutput satoshis */
            satoshis?: (number|Long|null);

            /** IndexedOutput blockHeight */
            blockHeight?: (number|null);

            /** IndexedOutput blockIdx */
            blockIdx?: (number|Long|null);

            /** IndexedOutput events */
            events?: (string[]|null);

            /** IndexedOutput owners */
            owners?: (Uint8Array[]|null);

            /** IndexedOutput spendTxid */
            spendTxid?: (Uint8Array|null);

            /** IndexedOutput data */
            data?: ({ [k: string]: Uint8Array }|null);
        }

        /** Represents an IndexedOutput. */
        class IndexedOutput implements IIndexedOutput {

            /**
             * Constructs a new IndexedOutput.
             * @param [properties] Properties to set
             */
            constructor(properties?: onesat.parse.IIndexedOutput);

            /** IndexedOutput outpoint. */
            public outpoint?: (onesat.parse.IOutPoint|null);

            /** IndexedOutput satoshis. */
            public satoshis: (number|Long);

            /** IndexedOutput blockHeight. */
            public blockHeight: number;

            /** IndexedOutput blockIdx. */
            public blockIdx: (number|Long);

            /** IndexedOutput events. */
            public events: string[];

            /** IndexedOutput owners. */
            public owners: Uint8Array[];

            /** IndexedOutput spendTxid. */
            public spendTxid: Uint8Array;

            /** IndexedOutput data. */
            public data: { [k: string]: Uint8Array };

            /**
             * Creates a new IndexedOutput instance using the specified properties.
             * @param [properties] Properties to set
             * @returns IndexedOutput instance
             */
            public static create(properties?: onesat.parse.IIndexedOutput): onesat.parse.IndexedOutput;

            /**
             * Encodes the specified IndexedOutput message. Does not implicitly {@link onesat.parse.IndexedOutput.verify|verify} messages.
             * @param message IndexedOutput message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: onesat.parse.IIndexedOutput, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified IndexedOutput message, length delimited. Does not implicitly {@link onesat.parse.IndexedOutput.verify|verify} messages.
             * @param message IndexedOutput message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: onesat.parse.IIndexedOutput, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes an IndexedOutput message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns IndexedOutput
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): onesat.parse.IndexedOutput;

            /**
             * Decodes an IndexedOutput message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns IndexedOutput
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): onesat.parse.IndexedOutput;

            /**
             * Verifies an IndexedOutput message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates an IndexedOutput message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns IndexedOutput
             */
            public static fromObject(object: { [k: string]: any }): onesat.parse.IndexedOutput;

            /**
             * Creates a plain object from an IndexedOutput message. Also converts values to other types if specified.
             * @param message IndexedOutput
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: onesat.parse.IndexedOutput, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this IndexedOutput to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for IndexedOutput
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }

        /** Properties of a BeefParseResult. */
        interface IBeefParseResult {

            /** BeefParseResult outputs */
            outputs?: (onesat.parse.IIndexedOutput[]|null);

            /** BeefParseResult spends */
            spends?: (onesat.parse.IIndexedOutput[]|null);

            /** BeefParseResult txid */
            txid?: (Uint8Array|null);

            /** BeefParseResult blockHeight */
            blockHeight?: (number|null);

            /** BeefParseResult blockIdx */
            blockIdx?: (number|Long|null);
        }

        /** Represents a BeefParseResult. */
        class BeefParseResult implements IBeefParseResult {

            /**
             * Constructs a new BeefParseResult.
             * @param [properties] Properties to set
             */
            constructor(properties?: onesat.parse.IBeefParseResult);

            /** BeefParseResult outputs. */
            public outputs: onesat.parse.IIndexedOutput[];

            /** BeefParseResult spends. */
            public spends: onesat.parse.IIndexedOutput[];

            /** BeefParseResult txid. */
            public txid: Uint8Array;

            /** BeefParseResult blockHeight. */
            public blockHeight: number;

            /** BeefParseResult blockIdx. */
            public blockIdx: (number|Long);

            /**
             * Creates a new BeefParseResult instance using the specified properties.
             * @param [properties] Properties to set
             * @returns BeefParseResult instance
             */
            public static create(properties?: onesat.parse.IBeefParseResult): onesat.parse.BeefParseResult;

            /**
             * Encodes the specified BeefParseResult message. Does not implicitly {@link onesat.parse.BeefParseResult.verify|verify} messages.
             * @param message BeefParseResult message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encode(message: onesat.parse.IBeefParseResult, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Encodes the specified BeefParseResult message, length delimited. Does not implicitly {@link onesat.parse.BeefParseResult.verify|verify} messages.
             * @param message BeefParseResult message or plain object to encode
             * @param [writer] Writer to encode to
             * @returns Writer
             */
            public static encodeDelimited(message: onesat.parse.IBeefParseResult, writer?: $protobuf.Writer): $protobuf.Writer;

            /**
             * Decodes a BeefParseResult message from the specified reader or buffer.
             * @param reader Reader or buffer to decode from
             * @param [length] Message length if known beforehand
             * @returns BeefParseResult
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decode(reader: ($protobuf.Reader|Uint8Array), length?: number): onesat.parse.BeefParseResult;

            /**
             * Decodes a BeefParseResult message from the specified reader or buffer, length delimited.
             * @param reader Reader or buffer to decode from
             * @returns BeefParseResult
             * @throws {Error} If the payload is not a reader or valid buffer
             * @throws {$protobuf.util.ProtocolError} If required fields are missing
             */
            public static decodeDelimited(reader: ($protobuf.Reader|Uint8Array)): onesat.parse.BeefParseResult;

            /**
             * Verifies a BeefParseResult message.
             * @param message Plain object to verify
             * @returns `null` if valid, otherwise the reason why it is not
             */
            public static verify(message: { [k: string]: any }): (string|null);

            /**
             * Creates a BeefParseResult message from a plain object. Also converts values to their respective internal types.
             * @param object Plain object
             * @returns BeefParseResult
             */
            public static fromObject(object: { [k: string]: any }): onesat.parse.BeefParseResult;

            /**
             * Creates a plain object from a BeefParseResult message. Also converts values to other types if specified.
             * @param message BeefParseResult
             * @param [options] Conversion options
             * @returns Plain object
             */
            public static toObject(message: onesat.parse.BeefParseResult, options?: $protobuf.IConversionOptions): { [k: string]: any };

            /**
             * Converts this BeefParseResult to JSON.
             * @returns JSON object
             */
            public toJSON(): { [k: string]: any };

            /**
             * Gets the default type url for BeefParseResult
             * @param [typeUrlPrefix] your custom typeUrlPrefix(default "type.googleapis.com")
             * @returns The default type url
             */
            public static getTypeUrl(typeUrlPrefix?: string): string;
        }
    }
}
