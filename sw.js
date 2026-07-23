// オフライン用サービスワーカー: 一度開けば、通信が無くても遊べるようにする
//
// ■ ファイルを増やしたときは下の FILES に追記し、CACHE の番号(v1→v2)を上げる
//   (番号を上げないとスマホが古い版を持ち続けることがある)
var CACHE = "dot-calc-v1";

var FILES = [
	"./",
	"./index.html",
	"./manifest.json",
	"./css/style.css",
	"./js/font.js",
	"./js/exact.js",
	"./js/parser.js",
	"./js/layout.js",
	"./js/sprites.js",
	"./js/game.js",
	"./js/flappy.js",
	"./js/duel.js",
	"./js/ui.js",
	"./icons/icon-180.png",
	"./icons/icon-192.png",
	"./icons/icon-512.png"
];

// 初回: 必要なファイルを全部ためこむ
self.addEventListener("install", function (ev) {
	ev.waitUntil(
		caches.open(CACHE).then(function (c) { return c.addAll(FILES); })
			.then(function () { return self.skipWaiting(); })
	);
});

// 古い版のためこみを片付ける
self.addEventListener("activate", function (ev) {
	ev.waitUntil(
		caches.keys().then(function (keys) {
			return Promise.all(keys.map(function (k) {
				return k === CACHE ? null : caches.delete(k);
			}));
		}).then(function () { return self.clients.claim(); })
	);
});

// 通信できるときは新しいものを取りに行き、ダメならためこみから出す
// (編集がすぐ反映され、圏外でも動く)
self.addEventListener("fetch", function (ev) {
	var req = ev.request;
	if (req.method !== "GET") return;
	ev.respondWith(
		fetch(req).then(function (res) {
			if (res && res.ok && new URL(req.url).origin === self.location.origin) {
				var copy = res.clone();
				caches.open(CACHE).then(function (c) { c.put(req, copy); });
			}
			return res;
		}).catch(function () {
			return caches.match(req).then(function (hit) {
				return hit || caches.match("./index.html");
			});
		})
	);
});
