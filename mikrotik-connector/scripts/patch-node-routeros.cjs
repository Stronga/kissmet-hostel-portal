const fs = require("fs");
const path = require("path");
const target = path.join(__dirname, "..", "node_modules", "node-routeros", "dist", "Channel.js");
if (!fs.existsSync(target)) process.exit(0);
let text = fs.readFileSync(target, "utf8");
if (text.includes("case '!empty':")) {
  process.exit(0);
}
const old = `        switch (reply) {
            case '!re':
                if (this.streaming)
                    this.emit('stream', parsed);
                break;
            case '!done':
                if (!this.trapped)
                    this.emit('done', this.data);
                this.close();
                break;
            default:
                this.emit('unknown', reply);
                this.close();
                break;
        }`;
const neu = `        switch (reply) {
            case '!re':
                if (this.streaming)
                    this.emit('stream', parsed);
                break;
            case '!empty':
                // RouterOS 7: empty filtered print; wait for following !done
                break;
            case '!done':
                if (!this.trapped)
                    this.emit('done', this.data);
                this.close();
                break;
            default:
                this.emit('unknown', reply);
                this.close();
                break;
        }`;
if (!text.includes(old)) {
  console.warn("patch-node-routeros: unexpected Channel.js shape; skipped");
  process.exit(0);
}
fs.writeFileSync(target, text.replace(old, neu));
console.log("patched node-routeros Channel.js for RouterOS 7 !empty");
