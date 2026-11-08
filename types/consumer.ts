import aihttp = require('../aihttp');

const text: string = aihttp.snapshot({ maxActions: 10, maxText: 200 });
const json = aihttp.snapshot({ format: 'json' });
const status = aihttp.status();
const action = aihttp.tools();

aihttp.act('a1', { value: 'hello' }).then((result) => {
  if (result.ok && result.diff) {
    console.log(result.diff.summary);
  }
});

if (json.locked === false) {
  console.log(json.actions.length);
}
console.log(text + status.state + action.tools.length);
