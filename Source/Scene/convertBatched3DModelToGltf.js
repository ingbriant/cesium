import Cartesian3 from '../Core/Cartesian3.js';
import clone from '../Core/clone.js';
import ComponentDatatype from '../Core/ComponentDatatype.js';
import defaultValue from '../Core/defaultValue.js';
import deprecationWarning from '../Core/deprecationWarning.js';
import defined from '../Core/defined.js';
import getStringFromTypedArray from '../Core/getStringFromTypedArray.js';
import Matrix4 from '../Core/Matrix4.js';
import RuntimeError from '../Core/RuntimeError.js';
import Axis from '../Scene/Axis.js';
import addExtensionsUsed from '../ThirdParty/GltfPipeline/addExtensionsUsed.js';
import parseGlb from '../ThirdParty/GltfPipeline/parseGlb.js';
import ForEach from '../ThirdParty/GltfPipeline/ForEach.js';

/**
 * @private
 */
function convertBatched3DModelToGltf(arrayBuffer, byteOffset) {
    var extracted = extractB3dm(arrayBuffer, byteOffset);

    var featuresLength = extracted.batchLength;
    var batchTableJson = extracted.batchTableJson;
    var batchTableBinary = extracted.batchTableBinary;
    var glb = extracted.glb;
    var rtcCenter = extracted.rtcCenter;

    var gltf = parseGlb(glb);

    if (defined(rtcCenter)) {
        Matrix4.multiplyByPoint(Axis.Z_UP_TO_Y_UP, rtcCenter, rtcCenter);
        if (defined(gltf.scenes) && defined(gltf.scene)) {
            var scene = gltf.scenes[gltf.scene];
            var sceneNodes = scene.nodes;
            if (defined(sceneNodes) && defined(gltf.nodes)) {
                scene.nodes = [gltf.nodes.length];
                gltf.nodes.push({
                    children: sceneNodes,
                    translation: rtcCenter
                });
            }
        }
    }

    var gltfCompanion = {
        bufferIndexToSource : {}
    };

    var result = {
        gltf : gltf,
        gltfCompanion : gltfCompanion
    };

    if (!defined(batchTableJson)) {
        return result;
    }

    var featureProperties = {};

    var featureTable = {
        featureCount : featuresLength,
        featureProperties : featureProperties
    };

    var hasBinaryProperties = false;

    for (var propertyName in batchTableJson) {
        if (batchTableJson.hasOwnProperty(propertyName) && isPropertyName(propertyName)) {
            var property = clone(batchTableJson[propertyName], true); // Deep clone so that the batch table json is released
            if (defined(property.byteOffset)) {
                hasBinaryProperties = true;
                var accessor = createAccessorFromBinaryProperty(property, batchTableBinary, featuresLength, gltf);
                featureProperties[propertyName] = {
                    accessor : accessor
                };
            } else {
                featureProperties[propertyName] = {
                    array : {
                        type : 'any',
                        values : property
                    }
                };
            }
        }
    }

    if (hasBinaryProperties) {
        var bufferIndex = gltf.buffers.length;

        gltf.buffers.push({
            byteLength : batchTableBinary.byteLength
        });

        gltfCompanion.bufferIndexToSource[bufferIndex] = batchTableBinary;
    }

    ForEach.mesh(gltf, function(mesh) {
        ForEach.meshPrimitive(mesh, function(primitive) {
            var attributes = primitive.attributes;
            if (defined(attributes._BATCHID)) {
                attributes._FEATURE_ID_0 = attributes._BATCHID;
                delete attributes._BATCHID;

                primitive.extensions = defined(primitive.extensions) ? primitive.extensions : {};
                primitive.extensions.EXT_3dtiles_feature_metadata = {
                    featureLayers : [
                        {
                            featureTable : 0,
                            featureIds: {
                                attribute: '_FEATURE_ID_0'
                            }
                        }
                    ]
                };
            }
        });
    });

    addExtensionsUsed(gltf, 'EXT_3dtiles_feature_metadata');

    gltf.extensions = defined(gltf.extensions) ? gltf.extensions : {};
    gltf.extensions.EXT_3dtiles_feature_metadata = {
        featureTables : [featureTable]
    };

    return result;
}

// This can be overridden for testing purposes
convertBatched3DModelToGltf._deprecationWarning = deprecationWarning;

function isPropertyName(propertyName) {
    return propertyName !== 'HIERARCHY' // Deprecated HIERARCHY property
        && propertyName !== 'extensions'
        && propertyName !== 'extras';
}

var sizeOfUint32 = Uint32Array.BYTES_PER_ELEMENT;
var sizeOfFloat = Float32Array.BYTES_PER_ELEMENT;
var sizeOfDouble = Float64Array.BYTES_PER_ELEMENT;

function createAccessorFromBinaryProperty(binaryProperty, batchTableBinary, featuresLength, gltf) {
    var byteOffset = binaryProperty.byteOffset;
    var componentType = binaryProperty.componentType;
    var type = binaryProperty.type;

    if (!defined(byteOffset)) {
        throw new RuntimeError('byteOffset is required.');
    }
    if (!defined(componentType)) {
        throw new RuntimeError('componentType is required.');
    }
    if (!defined(type)) {
        throw new RuntimeError('type is required.');
    }
    if (!defined(batchTableBinary)) {
        throw new RuntimeError('Property ' + name + ' requires a batch table binary.');
    }

    var componentDatatype = ComponentDatatype.fromName(componentType);
    var componentsLength = typeToComponentsLength(type) * featuresLength;

    if (componentDatatype === ComponentDatatype.DOUBLE) {
        // DOUBLE is not a valid glTF accessor type. Convert to FLOAT in-place.
        var dataView = new DataView(batchTableBinary.buffer, batchTableBinary.byteOffset + byteOffset, componentsLength * sizeOfDouble);
        for (var i = 0; i < componentsLength; ++i) {
            var doubleByteOffset = i * sizeOfDouble;
            var floatByteOffset = i * sizeOfFloat;
            var value = dataView.getFloat64(doubleByteOffset, true);
            dataView.setFloat32(floatByteOffset, value, true);
        }
        componentDatatype = ComponentDatatype.FLOAT;
    }

    var componentTypeByteLength = ComponentDatatype.getSizeInBytes(componentDatatype);
    var byteLength = componentTypeByteLength * componentsLength;

    gltf.buffers = defined(gltf.buffers) ? gltf.buffers : [];
    gltf.bufferViews = defined(gltf.bufferViews) ? gltf.bufferViews : [];
    gltf.accessors = defined(gltf.accessors) ? gltf.accessors : [];

    var bufferIndex = gltf.buffers.length;
    var bufferViewIndex = gltf.bufferViews.length;
    var accessorIndex = gltf.accessors.length;

    var accessor = {
        bufferView : bufferViewIndex,
        byteOffset : 0,
        componentType : componentDatatype,
        count : featuresLength,
        type : type
    };

    var bufferView = {
        buffer : bufferIndex,
        byteOffset : byteOffset,
        byteLength : byteLength
    };

    gltf.bufferViews.push(bufferView);
    gltf.accessors.push(accessor);

    return accessorIndex;
}

function typeToComponentsLength(type) {
    switch (type) {
        case 'SCALAR':
            return 1;
        case 'VEC2':
            return 2;
        case 'VEC3':
            return 3;
        case 'VEC4':
            return 4;
    }
}

function extractB3dm(arrayBuffer, byteOffset) {
    var byteStart = defaultValue(byteOffset, 0);
    byteOffset = byteStart;

    var uint8Array = new Uint8Array(arrayBuffer);
    var view = new DataView(arrayBuffer);
    byteOffset += sizeOfUint32;  // Skip magic

    var version = view.getUint32(byteOffset, true);
    if (version !== 1) {
        throw new RuntimeError('Only Batched 3D Model version 1 is supported.  Version ' + version + ' is not.');
    }
    byteOffset += sizeOfUint32;

    var byteLength = view.getUint32(byteOffset, true);
    byteOffset += sizeOfUint32;

    var featureTableJsonByteLength = view.getUint32(byteOffset, true);
    byteOffset += sizeOfUint32;

    var featureTableBinaryByteLength = view.getUint32(byteOffset, true);
    byteOffset += sizeOfUint32;

    var batchTableJsonByteLength = view.getUint32(byteOffset, true);
    byteOffset += sizeOfUint32;

    var batchTableBinaryByteLength = view.getUint32(byteOffset, true);
    byteOffset += sizeOfUint32;

    var batchLength;

    // Legacy header #1: [batchLength] [batchTableByteLength]
    // Legacy header #2: [batchTableJsonByteLength] [batchTableBinaryByteLength] [batchLength]
    // Current header: [featureTableJsonByteLength] [featureTableBinaryByteLength] [batchTableJsonByteLength] [batchTableBinaryByteLength]
    // If the header is in the first legacy format 'batchTableJsonByteLength' will be the start of the JSON string (a quotation mark) or the glTF magic.
    // Accordingly its first byte will be either 0x22 or 0x67, and so the minimum uint32 expected is 0x22000000 = 570425344 = 570MB. It is unlikely that the feature table JSON will exceed this length.
    // The check for the second legacy format is similar, except it checks 'batchTableBinaryByteLength' instead
    if (batchTableJsonByteLength >= 570425344) {
        // First legacy check
        byteOffset -= sizeOfUint32 * 2;
        batchLength = featureTableJsonByteLength;
        batchTableJsonByteLength = featureTableBinaryByteLength;
        batchTableBinaryByteLength = 0;
        featureTableJsonByteLength = 0;
        featureTableBinaryByteLength = 0;
        convertBatched3DModelToGltf._deprecationWarning('b3dm-legacy-header', 'This b3dm header is using the legacy format [batchLength] [batchTableByteLength]. The new format is [featureTableJsonByteLength] [featureTableBinaryByteLength] [batchTableJsonByteLength] [batchTableBinaryByteLength] from https://github.com/CesiumGS/3d-tiles/tree/master/specification/TileFormats/Batched3DModel.');
    } else if (batchTableBinaryByteLength >= 570425344) {
        // Second legacy check
        byteOffset -= sizeOfUint32;
        batchLength = batchTableJsonByteLength;
        batchTableJsonByteLength = featureTableJsonByteLength;
        batchTableBinaryByteLength = featureTableBinaryByteLength;
        featureTableJsonByteLength = 0;
        featureTableBinaryByteLength = 0;
        convertBatched3DModelToGltf._deprecationWarning('b3dm-legacy-header', 'This b3dm header is using the legacy format [batchTableJsonByteLength] [batchTableBinaryByteLength] [batchLength]. The new format is [featureTableJsonByteLength] [featureTableBinaryByteLength] [batchTableJsonByteLength] [batchTableBinaryByteLength] from https://github.com/CesiumGS/3d-tiles/tree/master/specification/TileFormats/Batched3DModel.');
    }

    var featureTableJson;
    if (featureTableJsonByteLength === 0) {
        featureTableJson = {
            BATCH_LENGTH : defaultValue(batchLength, 0)
        };
    } else {
        var featureTableString = getStringFromTypedArray(uint8Array, byteOffset, featureTableJsonByteLength);
        featureTableJson = JSON.parse(featureTableString);
        byteOffset += featureTableJsonByteLength;
    }

    byteOffset += featureTableBinaryByteLength;

    batchLength = featureTableJson['BATCH_LENGTH'];

    var batchTableJson;
    var batchTableBinary;
    if (batchTableJsonByteLength > 0) {
        var batchTableString = getStringFromTypedArray(uint8Array, byteOffset, batchTableJsonByteLength);
        batchTableJson = JSON.parse(batchTableString);
        byteOffset += batchTableJsonByteLength;

        if (batchTableBinaryByteLength > 0) {
            // Has a batch table binary
            batchTableBinary = new Uint8Array(arrayBuffer, byteOffset, batchTableBinaryByteLength);
            // Copy the batchTableBinary section and let the underlying ArrayBuffer be freed
            batchTableBinary = new Uint8Array(batchTableBinary);
            byteOffset += batchTableBinaryByteLength;
        }
    }

    var gltfByteLength = byteStart + byteLength - byteOffset;
    if (gltfByteLength === 0) {
        throw new RuntimeError('glTF byte length must be greater than 0.');
    }

    var glb;
    if (byteOffset % 4 === 0) {
        glb = new Uint8Array(arrayBuffer, byteOffset, gltfByteLength);
    } else {
        // Create a copy of the glb so that it is 4-byte aligned
        convertBatched3DModelToGltf._deprecationWarning('b3dm-glb-unaligned', 'The embedded glb is not aligned to a 4-byte boundary.');
        glb = new Uint8Array(uint8Array.subarray(byteOffset, byteOffset + gltfByteLength));
    }

    var rtcCenter;
    if (defined(featureTableJson['RTC_CENTER'])) {
        rtcCenter = Cartesian3.fromArray(featureTableJson['RTC_CENTER']);
    }

    return {
        batchLength : batchLength,
        batchTableJson : batchTableJson,
        batchTableBinary : batchTableBinary,
        glb : glb,
        rtcCenter : rtcCenter
    };
}

export default convertBatched3DModelToGltf;
