"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractExternalDependencies = function (dependencies) {
    return Object.keys(dependencies)
        .filter(function (key) {
        return dependencies[key].type === 'package';
    })
        .reduce(function (acc, key) {
        var depInfo = dependencies[key];
        if (depInfo.path) {
            acc[depInfo.path] = depInfo.version;
        }
        return acc;
    }, {});
};
exports.groupChunksByFileId = function (chunks) {
    return chunks.reduce(function (chunksByFileId, chunk) {
        var fileId = (chunk.meta && chunk.meta.fileId) || 'default';
        if (!chunksByFileId[fileId]) {
            chunksByFileId[fileId] = [];
        }
        chunksByFileId[fileId].push(chunk);
        return chunksByFileId;
    }, {});
};
//# sourceMappingURL=utils.js.map