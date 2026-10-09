import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {renderToStaticMarkup} from 'react-dom/server';
import {Select} from '../apps/web/src/components/Select.js';

test('Select reserves readable flex/grid width and wraps labels; browser fixture checks actual geometry',()=>{
  const css=readFileSync('apps/web/src/batch1.css','utf8');
  assert.match(css,/\.ui-select\s*\{[^}]*min-inline-size:\s*min\(100%,\s*8rem\)/);
  assert.match(css,/\.ui-select\s*\{[^}]*flex:\s*1 1 8rem/);
  assert.match(css,/\.ui-select-trigger > span\s*\{[^}]*white-space:\s*normal/);
  assert.match(css,/\.ui-select-trigger > svg\s*\{[^}]*flex:\s*none/);
  assert.match(css,/\.ui-select button\.ui-select-trigger\s*\{[^}]*min-inline-size:\s*0/);
  for(const layout of ['flex','grid']){
    const markup=renderToStaticMarkup(<div style={{display:layout,width:96}}><Select name="kit" defaultValue="kit"><option value="kit">窄列内容方案</option></Select></div>);
    assert.match(markup,/class="ui-select /);assert.match(markup,/name="kit"/);
  }
  const studio=readFileSync('apps/web/src/studio-view.tsx','utf8');
  assert.doesNotMatch(studio,/<strong className="studio-kit-name">/);
});
