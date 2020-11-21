
import {assert, svgElements, xNode} from './utils.js'


export function buildRuntime() {
    let runtime = xNode('function', {name: '', inline: true});
    runtime.push(xNode((ctx) => {
        if(this.inuse.apply) ctx.writeLine('let $cd = $component.$cd;');
    }));

    let bb = this.buildBlock(this.DOM);

    let rootTemplate = bb.tpl;
    runtime.push(bb.source);

    if(bb.svg) {
        runtime.push(`const rootTemplate = $runtime.svgToFragment(\`${this.Q(rootTemplate)}\`);`);
    } else {
        runtime.push(`const rootTemplate = $$htmlToFragment(\`${this.Q(rootTemplate)}\`);`);
    }
    runtime.push(xNode('raw:template', {
        name: bb.name
    }, (ctx, n) => {
        if(this.inuse.apply) ctx.writeLine(`${n.name}($cd, rootTemplate);`);
        else ctx.writeLine(`${n.name}(null, rootTemplate);`);
        ctx.writeLine(`$component.$$render(rootTemplate);`);
    }));

    if(this.script.onMount) {
        runtime.push(`if($option.noMount) $component.onMount = onMount;`);
        runtime.push(`else $tick(onMount);`);
    }
    if(this.script.onDestroy) runtime.push(`$runtime.cd_onDestroy($cd, onDestroy);`);
    if(this.script.watchers.length) {
        this.script.watchers.forEach(n => runtime.push(n));
    }

    runtime.push(xNode('addStyle', ctx => {
        if(!this.css) return;
        ctx.writeLine(`$runtime.addStyles('${this.css.id}', \`${this.Q(this.css.getContent())}\`);`);
    }));

    runtime.push(xNode('raw:apply', ctx => {
        if(this.inuse.apply) ctx.writeLine('$$apply();');
    }));

    runtime.push(`return $component;`);

    let result = xNode(ctx => {
        ctx.writeIdent();
        ctx.write('return (');
        ctx.build(runtime);
        ctx.write(')();\n');
    });

    this.module.body.push(result);

    this.module.head.push(xNode('resolveClass', (ctx) => {
        if(!this.inuse.resolveClass) return;
        if(this.css) {
            let {classMap, metaClass, main} = this.css.getClassMap();
            if(main) main = `'${main}'`;
            else main = 'null';
            classMap = Object.entries(classMap).map(i => `'${i[0]}': '${i[1]}'`).join(', ');
            metaClass = Object.entries(metaClass).map(i => {
                let value = i[1] === true ? 'true' : `'${i[1]}'`;
                return `'${i[0]}': ${value}`;
            }).join(', ');

            ctx.writeLine(`const $$resolveClass = $runtime.makeClassResolver(`);
            ctx.indent++;
            ctx.writeLine(`$option, {${classMap}}, {${metaClass}}, ${main}`)
            ctx.indent--;
            ctx.writeLine(`};`)
        } else {
            ctx.writeLine(`const $$resolveClass = $runtime.noop;`);
        }
    }))
}


export function buildBlock(data, option) {
    let tpl = [];
    let lvl = [];
    let binds = xNode('block');
    let DN = {};
    let result = {};
    let lastTag = false;

    const go = (level, data, isRoot) => {
        let index = 0;
        const setLvl = () => {lvl[level] = index++;}

        const getElementName = (shift) => {
            let cl;
            if(shift) cl = lvl.slice(0, lvl.length + shift);
            else cl = lvl.slice();

            let d = DN;
            cl.forEach(n => {
                if(d[n] == null) d[n] = {};
                d = d[n];
            });
            if(!d.name) d.name = `el${this.uniqIndex++}`;
            return d.name;
        };

        let body = data.body.filter(n => {
            if(n.type == 'script' || n.type == 'style' || n.type == 'slot') return false;
            if(n.type == 'comment' && !this.config.preserveComments) return false;
            if(n.type == 'fragment') {
                try {
                    let b = this.makeFragment(n);
                    binds.push(b.source);
                } catch (e) {
                    wrapException(e, n);
                }
                return false;
            }
            return true;
        });

        if(isRoot) {
            let svg = false, other = false;
            body.some(node => {
                if(node.type != 'node') return;
                if(svgElements[node.name]) svg = true;
                else return other = true;
            });
            if(svg && !other) result.svg = true;
        }

        {
            let i = 0;
            while(i < body.length - 1) {
                let node = body[i];
                let next = body[i + 1];
                if(node.type == 'text' && next.type == 'text') {
                    node.value += next.value;
                    body.splice(i + 1, 1);
                    continue;
                }
                i++;
            }
        }

        let lastText;
        const bindNode = (n) => {
            if(n.type === 'text') {
                assert(lastText !== tpl.length);
                setLvl();
                if(n.value.indexOf('{') >= 0) {
                    tpl.push(' ');
                    let exp = this.parseText(n.value).result;

                    binds.push(xNode('bindText', {
                        el: getElementName(),
                        exp: exp
                    }, (ctx, n) => {
                        if(this.inuse.apply) ctx.writeLine(`$runtime.bindText($cd, ${n.el}, () => ${n.exp});`);
                        else ctx.writeLine(`${n.el}.textContent = ${n.exp};`);
                    }));

                } else tpl.push(n.value);
                lastText = tpl.length;
            } else if(n.type === 'template') {
                setLvl();
                tpl.push(n.openTag);
                tpl.push(n.content);
                tpl.push('</template>');
            } else if(n.type === 'node') {
                setLvl();
                if(n.name == 'component' || n.name.match(/^[A-Z]/)) {
                    // component
                    if(this.config.hideLabel) tpl.push(`<!---->`);
                    else tpl.push(`<!-- ${n.name} -->`);
                    let b = this.makeComponent(n, getElementName);
                    binds.push(b.bind);
                    lastTag = true;
                    return;
                }
                if(n.name == 'slot') {
                    let slotName = n.elArg || 'default';
                    if(this.config.hideLabel) tpl.push(`<!---->`);
                    else tpl.push(`<!-- Slot ${slotName} -->`);
                    let b = this.attachSlot(slotName, getElementName(), n);
                    binds.push(b.source);
                    lastTag = true;
                    return;
                }
                if(n.name == 'fragment') {
                    if(this.config.hideLabel) tpl.push(`<!---->`);
                    else tpl.push(`<!-- Fragment ${n.name} -->`);
                    let b = this.attachFragment(n, getElementName());
                    binds.push(b.source);
                    lastTag = true;
                    return;
                }

                let el = ['<' + n.name];
                if(n.attributes.some(a => a.name.startsWith('{...'))) {
                    n.spreadObject = 'spread' + (this.uniqIndex++);
                    if(this.css) n.classes.add(this.css.id);
                    this.require('apply');
                    binds.push(`
                        let ${n.spreadObject} = $runtime.$$makeSpreadObject($cd, ${getElementName()}, '${this.css && this.css.id}');
                    `);
                }
                n.attributes.forEach(p => {
                    let b = this.bindProp(p, getElementName, n);
                    if(b.prop) el.push(b.prop);
                    if(b.bind) binds.push(b.bind);
                });
                let className = Array.from(n.classes).join(' ');
                if(className) el.push(`class="${className}"`);

                el = el.join(' ');
                if(n.closedTag) {
                    el += n.voidTag ? '/>' : `></${n.name}>`;
                } else el += '>';
                tpl.push(el);

                if(!n.closedTag) {
                    go(level + 1, n);
                    tpl.push(`</${n.name}>`);
                }
            } else if(n.type === 'each') {
                setLvl();
                if(data.type == 'node' && data.body.length == 1) {
                    let eachBlock = this.makeEachBlock(n, {
                        elName: getElementName(-1),
                        onlyChild: true
                    });
                    binds.push(eachBlock.source);
                    return;
                } else {
                    if(this.config.hideLabel) tpl.push(`<!---->`);
                    else tpl.push(`<!-- ${n.value} -->`);
                    let eachBlock = this.makeEachBlock(n, {elName: getElementName()});
                    binds.push(eachBlock.source);
                    lastTag = true;
                    return;
                }
            } else if(n.type === 'if') {
                setLvl();
                if(this.config.hideLabel) tpl.push(`<!---->`);
                else tpl.push(`<!-- ${n.value} -->`);
                let ifBlock = this.makeifBlock(n, getElementName());
                binds.push(ifBlock.source);
                lastTag = true;
                return;
            } else if(n.type === 'systag') {
                let r = n.value.match(/^@(\w+)\s+(.*)$/)
                let name = r[1];
                let exp = r[2];

                if(name == 'html') {
                    setLvl();
                    if(this.config.hideLabel) tpl.push(`<!---->`);
                    else tpl.push(`<!-- html -->`);
                    binds.push(this.makeHtmlBlock(exp, getElementName()));
                    lastTag = true;
                    return;
                } else throw 'Wrong tag';
            } else if(n.type === 'await') {
                setLvl();
                if(this.config.hideLabel) tpl.push(`<!---->`);
                else tpl.push(`<!-- ${n.value} -->`);
                let block = this.makeAwaitBlock(n, getElementName());
                binds.push(block.source);
                lastTag = true;
                return;
            } else if(n.type === 'comment') {
                setLvl();
                tpl.push(n.content);
            }
            lastTag = false;
        }
        body.forEach(node => {
            try {
                bindNode(node);
            } catch (e) {
                wrapException(e, node);
            }
        });

        lvl.length = level;
    };
    go(0, data, true);
    if(lastTag && option && option.protectLastTag) tpl.push('<!---->');

    result.tpl = this.Q(tpl.join(''));

    if(!binds.empty()) {
        result.name = '$$build' + (this.uniqIndex++);

        let source = xNode('function', {
            name: result.name,
            args: ['$cd', '$parentElement'].concat([] || data.args)
        });

        const buildNodes = (d, lvl) => {
            let keys = Object.keys(d).filter(k => k != 'name');
            if(keys.length > 1 && !d.name) d.name = 'el' + (this.uniqIndex++);

            if(d.name) {
                let line = lvl.join('');
                source.push(`let ${d.name} = ${line};`);
                lvl = [d.name];
            }

            keys.forEach(k => {
                const p = k == 0 ? `[$runtime.firstChild]` : `[$runtime.childNodes][${k}]`;
                buildNodes(d[k], lvl.concat([p]))
            });
        }
        buildNodes(DN, ['$parentElement']);

        source.push(binds);
        result.source = source;
    } else {
        result.name = '$runtime.noop';
        result.source = null;
    }
    return result;
};

function wrapException(e, n) {
    if(typeof e === 'string') e = new Error(e);
    if(!e.details) {
        console.log('Node: ', n);
        if(n.type == 'text') e.details = n.value.trim();
        else if(n.type == 'node') e.details = n.openTag.trim();
        else if(n.type == 'each') e.details = n.value.trim();
        else if(n.type == 'if') e.details = n.value.trim();
    }
    throw e;
};
