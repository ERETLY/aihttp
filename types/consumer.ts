import ahttp = require('../ahttp');

const text: string = ahttp.snapshot({ maxActions: 10, maxText: 200 });
const json = ahttp.snapshot({ format: 'json' });
const status = ahttp.status();
const action = ahttp.tools();

ahttp.act('a1', { value: 'hello' }).then((result) => {
  if (result.ok && result.diff) {
    console.log(result.diff.summary);
  }
});

if (json.locked === false) {
  console.log(json.actions.length);
}
console.log(text + status.state + action.tools.length);
