# aihttp terminal demo

Runs against a local page; no network access is required. Regenerate with `node scripts/demo.js`.

```console
$ node bin/aihttp-cli.js http://127.0.0.1:3000/ --allow-private --no-stats
aihttp | Widget shop | http://127.0.0.1:3000/
a1 input "Email" ph="agent@example.com"
a2 select "Size" opts=2(Small|Large)
a3 button "Add to cart"
a4 button "Buy now"
a5 a "Shipping help" -> /help
[text: untrusted]
Email
Size
Widgets are in stock. Orders ship in two days.

$ node bin/aihttp-cli.js http://127.0.0.1:3000/ --allow-private --no-stats --query "Buy"
aihttp | Widget shop | http://127.0.0.1:3000/
a4 button "Buy now"
```
