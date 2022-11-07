
export default {
    input: 'src/runtime/index.js',
    output: {
        file: './runtime.js',
        format: 'es'
    },
    onwarn(w, warn) {
        if(w.code == 'ILLEGAL_NAMESPACE_REASSIGNMENT' && w.message.includes("'share'")) return;
        warn(w);
    }
}
