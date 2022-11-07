import { isSimpleName, assert, extractKeywords } from '../utils';
import { xNode } from '../xnode.js';


export function makeAwaitBlock(node, label) {
  let valueForThen, exp;

  let rx = node.value.match(/^#await\s+(.+)\s+then\s+(\S+)\s*$/s);
  if(rx) {
    assert(!node.parts.then);
    node.parts.then = node.parts.main;
    node.parts.main = null;
    exp = rx[1];
    valueForThen = rx[2];
  } else {
    rx = node.value.match(/^#await\s+(.+)\s*$/s);
    assert(rx);
    exp = rx[1].trim();
  }

  let keywords = extractKeywords(exp);

  let parts = [null, null, null];
  if(node.parts.main && node.parts.main.length) {
    parts[0] = this.buildBlock({ body: node.parts.main });
  }
  if(node.parts.then && node.parts.then.length) {
    let args = [];
    if(valueForThen) {
      assert(isSimpleName(valueForThen));
      args.push(valueForThen);
    } else {
      let rx = node.parts.thenValue.match(/^[^ ]+\s+(.*)$/s);
      if(rx) {
        assert(isSimpleName(rx[1]));
        args.push(rx[1]);
      }
    }
    parts[1] = this.buildBlock({ body: node.parts.then }, { extraArguments: args });
  }
  if(node.parts.catch && node.parts.catch.length) {
    let args = [];
    let rx = node.parts.catchValue.match(/^[^ ]+\s+(.*)$/s);
    if(rx) {
      assert(isSimpleName(rx[1]));
      args.push(rx[1]);
    }
    parts[2] = this.buildBlock({ body: node.parts.catch }, { extraArguments: args });
  }

  if(this.script.readOnly) {
    this.warning('script read-only conflicts with await');
    return;
  }
  this.detectDependency(exp);
  this.require('apply');

  return xNode('await', {
    label,
    exp,
    parts,
    keywords
  }, (ctx, n) => {
    ctx.write(true, `$runtime.awaitBlock(${n.label.name}, ${n.label.node ? 0 : 1}, () => [${n.keywords.join(', ')}], () => ${n.exp},`);
    ctx.indent++;
    n.parts.forEach((part, index) => {
      if(index) ctx.write(', ');
      if(part) {
        ctx.write(true);
        ctx.add(part.block);
      } else ctx.write('null');
    });
    ctx.indent--;
    ctx.write(');', true);
  });
}
