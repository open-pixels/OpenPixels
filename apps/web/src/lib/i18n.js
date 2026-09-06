/**
 * English and Simplified Chinese.
 *
 * The strings are deliberately plain. Someone here has a blurry photo of
 * their grandmother, not an interest in super-resolution; so the UI says
 * "make it bigger and sharper", and the words "super-resolution",
 * "inference" and "tensor" appear nowhere a user can see.
 *
 * The quality numbers get the same treatment: the panel leads with "twice
 * as sharp" and keeps PSNR and SSIM behind a disclosure for the few people
 * those mean something to.
 */

import { writable, derived, get } from "svelte/store";

const en = {
  "app.name": "OpenPixels",
  "app.tagline": "Make a blurry photo sharp, on your own phone.",
  "app.sub":
    "Enlarge up to 8x, clear up noise, rebuild faces, colour an old black-and-white photo, or cut out the background. Everything is free and nothing is uploaded.",

  "nav.batch": "Several at once",
  "nav.models": "Downloads",
  "nav.about": "What this costs",
  "nav.account": "Account",
  "nav.back": "Back",
  "nav.home": "Home",

  "promise.free.title": "Free, all of it",
  "promise.free.body":
    "Every feature on this page, with no account, no trial, no watermark and no limit on how many photos you do.",
  "promise.private.title": "Your photo stays here",
  "promise.private.body":
    "It is processed inside this browser tab. It is never uploaded, because there is no server to upload it to.",
  "promise.proof.title": "See what changed",
  "promise.proof.body":
    "Drag the slider to compare, and read the numbers underneath. No other tool in this category shows you either.",
  "promise.offline.ready": "Ready to work offline",

  "home.start": "Choose a photo",
  "home.camera": "Take a photo",
  "home.drop": "or drop one anywhere on this page",
  "install.title": "Add it to your home screen",
  "install.body":
    "It opens like an app, full screen, and works with no signal. It is the same page — nothing extra is installed.",
  "install.add": "Add it",
  "install.no": "Not now",

  "home.tips.title": "What it does best",
  "home.tips.1": "Small or low-resolution photos — old phone pictures, scans, screenshots.",
  "home.tips.2": "Photos softened by noise or heavy compression, from messaging apps.",
  "home.tips.3": "Faces that have gone soft, in scans and old family photographs.",
  "home.tips.4": "It cannot invent detail that was never captured. Nothing can.",

  "studio.title": "Your photo",
  "studio.original": "Original",
  "studio.result": "Result",
  "studio.run": "Enhance",
  "studio.rerun": "Apply changes",
  "studio.cancel": "Stop",
  "studio.working": "Working…",
  "studio.download": "Save the photo",
  "studio.share": "Save a before/after",
  "studio.another": "Another photo",
  "studio.drag": "Drag to compare",

  "opt.size": "Size",
  "opt.size.help": "How much larger to make it.",
  "opt.size.same": "Same size, just cleaner",
  "opt.kind": "What is it",
  "opt.kind.photo": "Photograph",
  "opt.kind.quality": "Photograph, best quality",
  "opt.kind.anime": "Drawing or anime",
  "opt.kind.help": "Picks the model. The best-quality one is a larger download and slower.",
  "opt.denoise": "Noise and grain",
  "opt.denoise.off": "Leave it",
  "opt.denoise.medium": "Reduce",
  "opt.denoise.strong": "Remove",
  "opt.denoise.help": "Also clears up the blocky edges left by heavy compression.",
  "opt.faces": "Rebuild faces",
  "opt.faces.help": "Finds faces and restores them. Adds a large one-time download.",
  "opt.faces.strength": "How strongly",
  "opt.colorize": "Add colour",
  "opt.colorize.help": "For a black-and-white photo. Adds a large one-time download.",
  "opt.colorize.hint": "This photo is black and white — you can add colour to it below.",
  "opt.colorize.saturation": "How vivid",
  "opt.colorize.hascolour":
    "This photo already has colour. Adding more replaces it with the model's guess, which usually looks worse.",
  "opt.sharpen": "Extra sharpening",
  "opt.background": "Background",
  "opt.background.keep": "Keep it",
  "opt.background.remove": "Remove it",
  "opt.background.white": "Make it white",
  "opt.background.colour": "Pick a colour",
  "opt.advanced": "More options",
  "opt.willdownload": "First run downloads {size} — after that it works offline.",

  "quality.title": "What changed",
  "quality.sharper": "{n}x sharper",
  "quality.sharper.none": "About as sharp",
  "quality.noise": "Noise {before} → {after}",
  "quality.noise.clean": "Already clean",
  "quality.size": "{w} × {h}, from {ow} × {oh}",
  "quality.faithful": "Faithful to the original",
  "quality.faithful.help":
    "Shrunk back to its original size, the result still matches the photo you started with — so the detail was enlarged, not invented.",
  "quality.numbers": "The numbers",
  "quality.psnr": "PSNR",
  "quality.ssim": "SSIM",
  "quality.sharpness": "Sharpness",
  "quality.noiselevel": "Noise",
  "quality.before": "Before",
  "quality.after": "After",
  "quality.explain":
    "PSNR and SSIM compare the result, shrunk back down, against your original — higher is more faithful. Sharpness is the variance of the Laplacian; noise is Immerkær's estimator. Both are measured on the same window of the image.",

  "progress.download": "Getting the {model} model ({percent}%)",
  "progress.upscale": "Enlarging ({percent}%)",
  "progress.upscale.pass": "Enlarging, pass {pass} of {passes} ({percent}%)",
  "progress.detect": "Looking for faces",
  "progress.detected.none": "No faces found",
  "progress.detected": "Restoring {count} face(s)",
  "progress.faces": "Restoring faces ({percent}%)",
  "progress.colorize": "Choosing colours",
  "progress.matte": "Separating the background",
  "progress.sharpen": "Sharpening",
  "progress.metrics": "Measuring the result",

  "batch.title": "Several at once",
  "batch.sub":
    "The same settings applied to every photo, one after another. No limit on how many, and nothing leaves your device.",
  "batch.add": "Choose photos",
  "batch.run": "Start",
  "batch.stop": "Stop",
  "batch.clear": "Clear the list",
  "batch.download": "Download all as a ZIP",
  "batch.csv": "Download the measurements",
  "batch.empty": "No photos yet.",
  "batch.status.waiting": "Waiting",
  "batch.status.running": "Working",
  "batch.status.done": "Done",
  "batch.status.failed": "Failed",
  "batch.done": "{done} of {total} done",

  "models.title": "Downloads",
  "models.sub":
    "Models are fetched the first time you use a feature and then kept on this device, so it works with no signal afterwards. Delete any of them here.",
  "models.on": "On this device",
  "models.off": "Not downloaded",
  "models.forget": "Delete",
  "models.forgetAll": "Delete all of them",
  "models.total": "{n} on this device, {size}",
  "models.offline": "This app is ready to work with no network.",
  "models.source.title": "Where models come from",
  "models.source.body":
    "The only thing this extension ever downloads. Point it at your own copy if you would rather not rely on ours — the file names and checksums are published, so you can verify what you are serving. Leave it empty for the default.",
  "models.source.save": "Save",
  "models.source.saved": "Saved. Delete any downloaded model above to re-fetch it from here.",
  "models.source.invalid": "That needs to be a full web address, starting with https://",

  "account.title": "Account",
  "account.lede":
    "Optional, and it unlocks nothing here. An account carries credits to our other apps; everything on this site stays free either way.",
  "account.signin.title": "Sign in",
  "account.signin.body":
    "One account across our apps. You do not need it here — nothing on this site is behind it.",
  "account.free.title": "Nothing here is behind it",
  "account.free.body":
    "Every feature runs on your own device, so it costs us nothing per photo and there is nothing to charge for. Signed in or not, you get all of it, with no limit.",
  "account.private.title": "Your photos are still not involved",
  "account.private.body":
    "Signing in sends an email address or a wallet signature to our account server, and nothing else. No photo is uploaded, before or after — there is still no server that accepts one.",
  "account.loading": "Loading the account tools…",
  "account.offline.title": "Could not reach the account server",
  "account.offline.body":
    "Everything else on this site works without it — nothing here depends on an account. Try again later.",

  "about.title": "What this costs",
  "about.free":
    "Nothing, and there is no version that costs something. No trial, no credit, no watermark and no limit — and nothing here is behind an account.",
  "about.how.title": "How that works",
  "about.how.body":
    "Your photo is processed by your own device, so running this costs us nothing per photo. Tools that charge for this send your photo to a server and pay for the GPU that handles it; that bill is what a subscription covers. There is no such bill here, so there is nothing to charge you for.",
  "about.privacy.title": "What we can see",
  "about.privacy.body":
    "Nothing. Your photo is never sent anywhere. The only things this page downloads are the app itself and the model files, from this same address, and after the first visit it downloads nothing at all.",
  "about.open.title": "Open source",
  "about.open.body":
    "The whole thing, including the exact steps that produced each model file and their checksums, so you can rebuild it and compare.",
  "about.notdoing.title": "What we deliberately do not do",
  "about.notdoing.body":
    "AI portrait generation — the feature that turns your photo into a stylised avatar. It cannot run on your device, so it would need a server and a price; and the products that do it draw steady complaints for changing people's skin tone and features. Enhancing your photo and inventing a new one are different jobs.",

  "permission.title": "One tap to read that image",
  "permission.body":
    "The image is on {origin}, and this extension does not ask for access to any site until you point it at one.",
  "permission.allow": "Allow, and enhance it",
  "permission.why":
    "Only that site, only to read the one image, and only until you remove it in your browser's extension settings. The image is still processed here and never uploaded.",

  "error.title": "That did not work",
  "error.decode": "That file could not be read as an image.",
  "error.memory":
    "This photo is too large for this browser to hold at that size. Try a smaller enlargement.",
  "error.retry": "Try again",
  "capped": "Working at {w} × {h} — the full size would be too large for a browser tab.",
  "common.close": "Close",
  "common.cancel": "Cancel",
};

const zh = {
  "app.name": "OpenPixels",
  "app.tagline": "在手机上把模糊的照片变清晰。",
  "app.sub":
    "最高放大 8 倍，去除噪点，修复人脸，为黑白老照片上色，或抠掉背景。全部免费，照片不会上传。",

  "nav.batch": "批量处理",
  "nav.models": "已下载",
  "nav.about": "收费说明",
  "nav.account": "账户",
  "nav.back": "返回",
  "nav.home": "首页",

  "promise.free.title": "全部免费",
  "promise.free.body": "本页所有功能，无需注册、无试用期、无水印，处理张数不限。",
  "promise.private.title": "照片留在你这里",
  "promise.private.body": "全部在这个浏览器标签页里处理。不会上传，因为根本没有可上传的服务器。",
  "promise.proof.title": "看得见的效果",
  "promise.proof.body": "拖动滑块对比前后，下方还有具体数值。同类工具没有一家提供这两样。",
  "promise.offline.ready": "已可离线使用",

  "home.start": "选择照片",
  "home.camera": "拍一张",
  "home.drop": "也可以把照片拖到本页任意位置",
  "install.title": "添加到主屏幕",
  "install.body": "像应用一样全屏打开，断网也能用。还是同一个页面，不会额外安装任何东西。",
  "install.add": "添加",
  "install.no": "以后再说",

  "home.tips.title": "最适合处理",
  "home.tips.1": "尺寸小、分辨率低的照片——旧手机拍的、扫描件、截图。",
  "home.tips.2": "被噪点或重压缩弄糊的照片，比如聊天软件里转发的。",
  "home.tips.3": "扫描件和老家庭照里变模糊的人脸。",
  "home.tips.4": "它无法凭空补出原本就没拍到的细节。没有任何工具可以。",

  "studio.title": "你的照片",
  "studio.original": "原图",
  "studio.result": "结果",
  "studio.run": "开始处理",
  "studio.rerun": "应用修改",
  "studio.cancel": "停止",
  "studio.working": "处理中…",
  "studio.download": "保存照片",
  "studio.share": "保存前后对比图",
  "studio.another": "换一张",
  "studio.drag": "拖动对比",

  "opt.size": "放大倍数",
  "opt.size.help": "要放大到多少。",
  "opt.size.same": "尺寸不变，只做清晰化",
  "opt.kind": "图片类型",
  "opt.kind.photo": "照片",
  "opt.kind.quality": "照片，最佳画质",
  "opt.kind.anime": "插画或动漫",
  "opt.kind.help": "决定用哪个模型。最佳画质那个下载更大、速度更慢。",
  "opt.denoise": "噪点与颗粒",
  "opt.denoise.off": "保留",
  "opt.denoise.medium": "减轻",
  "opt.denoise.strong": "去除",
  "opt.denoise.help": "同时也会清理重压缩留下的块状边缘。",
  "opt.faces": "修复人脸",
  "opt.faces.help": "自动找到人脸并修复。需要一次较大的下载。",
  "opt.faces.strength": "强度",
  "opt.colorize": "上色",
  "opt.colorize.help": "用于黑白照片。需要一次较大的下载。",
  "opt.colorize.hint": "这是一张黑白照片——可以在下面为它上色。",
  "opt.colorize.saturation": "鲜艳程度",
  "opt.colorize.hascolour": "这张照片本身有颜色。再上色会用模型推断的颜色替换原有颜色，通常效果更差。",
  "opt.sharpen": "额外锐化",
  "opt.background": "背景",
  "opt.background.keep": "保留",
  "opt.background.remove": "抠掉",
  "opt.background.white": "换成白色",
  "opt.background.colour": "选个颜色",
  "opt.advanced": "更多选项",
  "opt.willdownload": "首次运行需下载 {size}，之后即可离线使用。",

  "quality.title": "变化",
  "quality.sharper": "清晰度提升 {n} 倍",
  "quality.sharper.none": "清晰度基本相当",
  "quality.noise": "噪点 {before} → {after}",
  "quality.noise.clean": "本来就很干净",
  "quality.size": "{w} × {h}，原为 {ow} × {oh}",
  "quality.faithful": "忠于原图",
  "quality.faithful.help": "把结果缩回原始尺寸后，仍与你的原图吻合——说明细节是放大出来的，不是编出来的。",
  "quality.numbers": "具体数值",
  "quality.psnr": "PSNR",
  "quality.ssim": "SSIM",
  "quality.sharpness": "清晰度",
  "quality.noiselevel": "噪点",
  "quality.before": "处理前",
  "quality.after": "处理后",
  "quality.explain":
    "PSNR 与 SSIM 是把结果缩回原尺寸后与原图比较，越高越忠实。清晰度用拉普拉斯方差衡量，噪点用 Immerkær 估计法。两者取的是图像同一区域。",

  "progress.download": "正在获取{model}模型（{percent}%）",
  "progress.upscale": "正在放大（{percent}%）",
  "progress.upscale.pass": "正在放大，第 {pass}/{passes} 遍（{percent}%）",
  "progress.detect": "正在寻找人脸",
  "progress.detected.none": "没有找到人脸",
  "progress.detected": "正在修复 {count} 张人脸",
  "progress.faces": "正在修复人脸（{percent}%）",
  "progress.colorize": "正在推断颜色",
  "progress.matte": "正在分离背景",
  "progress.sharpen": "正在锐化",
  "progress.metrics": "正在测量结果",

  "batch.title": "批量处理",
  "batch.sub": "用同一组设置逐张处理。张数不限，且不会离开你的设备。",
  "batch.add": "选择多张照片",
  "batch.run": "开始",
  "batch.stop": "停止",
  "batch.clear": "清空列表",
  "batch.download": "打包下载 ZIP",
  "batch.csv": "下载测量数据",
  "batch.empty": "还没有照片。",
  "batch.status.waiting": "等待中",
  "batch.status.running": "处理中",
  "batch.status.done": "完成",
  "batch.status.failed": "失败",
  "batch.done": "已完成 {done}/{total}",

  "models.title": "已下载",
  "models.sub": "首次使用某个功能时才会下载对应模型，之后保存在本机，断网也能用。可以在这里删除。",
  "models.on": "已在本机",
  "models.off": "未下载",
  "models.forget": "删除",
  "models.forgetAll": "全部删除",
  "models.total": "本机已有 {n} 个，共 {size}",
  "models.offline": "本应用已可在无网络时使用。",
  "models.source.title": "模型来源",
  "models.source.body":
    "这是本扩展唯一会下载的东西。如果你不想依赖我们的服务器，可以指向自己的副本——文件名和校验和都是公开的，可自行核对。留空则使用默认地址。",
  "models.source.save": "保存",
  "models.source.saved": "已保存。删除上面任一已下载的模型，即可从新地址重新获取。",
  "models.source.invalid": "需要填写完整的网址，以 https:// 开头。",

  "account.title": "账户",
  "account.lede":
    "可选，而且不会解锁这里的任何功能。账户用于把积分带到我们的其他应用；本站的一切始终免费。",
  "account.signin.title": "登录",
  "account.signin.body": "一个账户通用于我们的各个应用。这里并不需要它——本站没有任何功能需要登录。",
  "account.free.title": "这里没有任何功能需要账户",
  "account.free.body":
    "所有功能都在你自己的设备上运行，我们每张照片的成本是零，也就没有可收费的东西。无论是否登录，功能全都可用，且没有次数限制。",
  "account.private.title": "你的照片依然与此无关",
  "account.private.body":
    "登录只会把邮箱地址或钱包签名发送到我们的账户服务器，除此之外没有别的。前后都不会上传照片——依然没有任何服务器会接收照片。",
  "account.loading": "正在加载账户工具……",
  "account.offline.title": "无法连接账户服务器",
  "account.offline.body": "本站其余功能都不依赖账户，可以照常使用。请稍后再试。",

  "about.title": "收费说明",
  "about.free": "不收费，也没有收费版本。没有试用、积分、水印或次数限制——而且这里没有任何功能需要账户。",
  "about.how.title": "为什么能免费",
  "about.how.body":
    "照片由你自己的设备处理，所以我们每处理一张的成本是零。收费的工具会把你的照片传到服务器，并为处理它的 GPU 付费，订阅费就是用来付这笔账的。这里没有这笔账，也就没有理由向你收费。",
  "about.privacy.title": "我们能看到什么",
  "about.privacy.body":
    "什么都看不到。你的照片不会被发送到任何地方。本页只从同一个地址下载应用本身和模型文件，首次访问之后连这些也不再下载。",
  "about.open.title": "开源",
  "about.open.body": "全部开源，包括生成每个模型文件的具体步骤和校验和，你可以自己重建并比对。",
  "about.notdoing.title": "我们刻意不做的",
  "about.notdoing.body":
    "AI 写真——把你的照片变成风格化头像的那类功能。它无法在你的设备上运行，只能依赖服务器并因此收费；而且做这件事的产品持续因为改变用户的肤色和五官被投诉。把你的照片修清楚，和另外生成一张，是两件事。",

  "permission.title": "还差一步：读取那张图片",
  "permission.body": "这张图片在 {origin} 上，而本扩展在你主动指定之前，不会申请任何网站的访问权限。",
  "permission.allow": "允许并开始处理",
  "permission.why":
    "仅限该网站，仅用于读取这一张图片，且可随时在浏览器的扩展设置中撤销。图片仍在本地处理，不会上传。",

  "error.title": "没能完成",
  "error.decode": "这个文件无法作为图片读取。",
  "error.memory": "以这个倍数处理，浏览器放不下这张照片。试试小一点的倍数。",
  "error.retry": "重试",
  "capped": "按 {w} × {h} 处理——完整尺寸超出浏览器标签页的承受范围。",
  "common.close": "关闭",
  "common.cancel": "取消",
};

const DICTS = { en, "zh-CN": zh };
export const LANGUAGES = [
  { value: "en", label: "English" },
  { value: "zh-CN", label: "简体中文" },
];

function initial() {
  try {
    const saved = localStorage.getItem("openpixels.lang");
    if (saved && DICTS[saved]) return saved;
  } catch {
    // Private mode, or storage disabled. The default is fine.
  }
  const nav = typeof navigator !== "undefined" ? navigator.language ?? "" : "";
  return nav.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

export const lang = writable(initial());
lang.subscribe((v) => {
  try {
    localStorage.setItem("openpixels.lang", v);
  } catch {
    // Nothing to do; the choice just will not survive a reload.
  }
  if (typeof document !== "undefined") document.documentElement.lang = v;
});

function format(template, vars) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (whole, key) => (key in vars ? String(vars[key]) : whole));
}

export const t = derived(lang, ($lang) => (key, vars) => {
  const dict = DICTS[$lang] ?? en;
  return format(dict[key] ?? en[key] ?? key, vars);
});

/** The same lookup outside a component. */
export function translate(key, vars) {
  return get(t)(key, vars);
}
