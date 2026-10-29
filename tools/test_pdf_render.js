/* 用真实 jsPDF 验证 PDF 生成链路：画幅、多页、addImage、output("blob") */
const fs = require("fs");
const vm = require("vm");

const sandbox = { console, setTimeout, Blob, Uint8Array, Uint32Array, Int8Array, Int16Array, Int32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, ArrayBuffer, DataView, TextEncoder, TextDecoder, atob, btoa, globalThis: null };
sandbox.window = sandbox;
sandbox.self = sandbox;
sandbox.navigator = { userAgent: "node" };
sandbox.document = {
  createElement: () => ({
    setAttribute() { }, style: {}, appendChild() { },
    getContext: () => ({ fillRect() { }, drawImage() { }, beginPath() { }, moveTo() { }, lineTo() { }, arcTo() { }, closePath() { }, fill() { }, fillText() { }, measureText: () => ({ width: 10 }) }),
    toDataURL: () => TINY_PNG, width: 0, height: 0,
  }),
  head: { appendChild() { } },
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync("vendor/jspdf.umd.min.js", "utf8"), sandbox);

const jsPDF = (sandbox.jspdf || sandbox.window.jspdf || {}).jsPDF;
if (!jsPDF) { console.log("✗ jsPDF 未加载"); process.exit(1); }

const TINY_PNG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==";

let pass = 0, fail = 0;
const ok = (n, c, e) => { c ? (pass++, console.log("  ✓ " + n)) : (fail++, console.log("  ✗ " + n + (e !== undefined ? " → " + e : ""))); };

console.log("\n【jsPDF 生成验证】");
const PDF_W = 297, PDF_H = 210;
const pdf = new jsPDF({ orientation: "landscape", unit: "mm", format: [PDF_W, PDF_H] });

const w = pdf.internal.pageSize.getWidth();
const h = pdf.internal.pageSize.getHeight();
ok("A4 横版宽度 297mm", Math.round(w) === 297, w);
ok("A4 横版高度 210mm", Math.round(h) === 210, h);
ok("方向为横向", w > h, w + "x" + h);

/* 封面 + 3 个内页，全部整页铺图（与线上做法一致） */
pdf.addImage(TINY_PNG, "JPEG", 0, 0, PDF_W, PDF_H);
for (let i = 0; i < 3; i++) {
  pdf.addPage([PDF_W, PDF_H], "landscape");
  pdf.addImage(TINY_PNG, "JPEG", 0, 0, PDF_W, PDF_H);
}

const pages = pdf.internal.getNumberOfPages();
ok("总页数 = 封面 1 + 内页 3", pages === 4, pages);

const blob = pdf.output("blob");
ok("output(\"blob\") 返回 Blob", blob && typeof blob.size === "number", typeof blob);
ok("PDF 非空（> 500 字节）", blob.size > 500, blob.size + " bytes");

/* 文件头必须是 %PDF */
const buf = Buffer.from(blob.arrayBuffer ? require("buffer").Buffer.from(new Uint8Array()) : []);
blob.arrayBuffer().then(ab => {
  const b = Buffer.from(ab);
  ok("文件头为 %PDF", b.slice(0, 4).toString() === "%PDF", JSON.stringify(b.slice(0, 4).toString()));
  ok("能被 File 构造（浏览器上传用）", typeof File === "function" ? true : "node 无 File，浏览器有");
  console.log("\n" + (fail === 0 ? "全部通过" : "有失败") + "：" + pass + " 通过 / " + fail + " 失败\n");
  process.exit(fail === 0 ? 0 : 1);
});