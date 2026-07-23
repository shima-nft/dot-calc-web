// UI v3: 数式通り入力+数学自然表示+分数の穴埋め入力+()自動判別+棒人間ランナー切替。
// ロジックは Exact/Parser/DotLayout/DotGame に委譲
(function () {
	"use strict";

	// ゲームボーイ4階調(暗→明)
	var GB = ["#0f380f", "#306230", "#8bac0f", "#9bbc0f"];
	var LCD_W = 97;
	var LCD_H = 45;
	var MARGIN = 2;

	// 電卓の状態
	var tokens = [];
	var phase = "input";     // input / result
	var ans = null;
	var approx = false;
	var errShown = false;
	var insertAt = null;     // 挿入位置。null=末尾。数値=分数の穴埋め中(分子に挿入)
	var mode = "calc";       // calc / menu(ゲーム選択) / game(プレイ中)
	var activeGame = null;   // プレイ中のゲーム(DotGame/DotFlappy/DotDuel/DotPet)

	var lcd = document.getElementById("lcd");
	lcd.width = LCD_W;
	lcd.height = LCD_H;
	var lctx = lcd.getContext("2d");

	// ---- トークン操作(挿入位置つき) ----
	function insertToken(tok) {
		if (insertAt === null) tokens.push(tok);
		else { tokens.splice(insertAt, 0, tok); insertAt++; }
	}

	function tokenBeforeCursor() {
		if (insertAt === null) return tokens.length ? tokens[tokens.length - 1] : null;
		return insertAt > 0 ? tokens[insertAt - 1] : null;
	}

	function cursorIndex() {
		return insertAt === null ? tokens.length : insertAt;
	}

	// ---- 描画 ----
	function displayTokens() {
		if (phase !== "input") return tokens;
		var arr = tokens.slice();
		arr.splice(cursorIndex(), 0, { t: "caret" });
		return arr;
	}

	function render() {
		if (mode !== "calc") return;
		lctx.fillStyle = GB[2];
		lctx.fillRect(0, 0, LCD_W, LCD_H);

		// 上段: 入力中の式(カーソル込み)
		var tree = Parser.parse(displayTokens(), true);
		var box = DotLayout.astBox(tree);
		var ex = MARGIN;
		if (box.w > LCD_W - MARGIN * 2) ex = LCD_W - MARGIN - box.w; // 右端を見せる
		box.draw(lctx, ex, MARGIN, GB[0]);

		// 下段: 答え(右寄せ)
		if (phase === "result") {
			var rbox;
			if (errShown) {
				rbox = DotLayout.textBox("ERR");
			} else {
				rbox = DotLayout.valueBox(ans, approx);
				if (rbox === null) rbox = DotLayout.textBox("ERR");
			}
			var ry = LCD_H - MARGIN - rbox.h;
			var rx = LCD_W - MARGIN - rbox.w;
			if (rx < MARGIN) rx = MARGIN;
			rbox.draw(lctx, rx, ry, GB[0]);
		}
	}

	function drawSprite(ctx, rows, x, y) {
		ctx.fillStyle = GB[0];
		for (var r = 0; r < rows.length; r++) {
			for (var col = 0; col < rows[r].length; col++) {
				if (rows[r][col] === "#") ctx.fillRect(x + col, y + r, 1, 1);
			}
		}
	}

	function renderButtonLabels() {
		var canvases = document.querySelectorAll("canvas.key-label");
		for (var i = 0; i < canvases.length; i++) {
			var c = canvases[i];
			var ch = c.getAttribute("data-char");
			c.width = DotFont.textWidth(ch.length) + 2;
			c.height = DotFont.GLYPH_H + 2;
			var ctx = c.getContext("2d");
			ctx.clearRect(0, 0, c.width, c.height);
			// 棒人間ボタンは走り1コマ目の絵を表示(sprites.js と同じ絵=編集も反映される)
			if (ch === "人" && window.DotSprites && DotSprites.RUN && DotSprites.RUN[0]) {
				drawSprite(ctx, DotSprites.RUN[0], 1, 1);
			} else {
				DotFont.drawText(ctx, ch, 1, 1, GB[0]);
			}
		}
	}

	// ---- 音(GB風の矩形波。初回タップでAudioContext解禁) ----
	var audioCtx = null;

	function beep(freq, dur) {
		try {
			if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
			if (audioCtx.state === "suspended") audioCtx.resume();
			var osc = audioCtx.createOscillator();
			var gain = audioCtx.createGain();
			osc.type = "square";
			osc.frequency.value = freq;
			gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
			gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
			osc.connect(gain).connect(audioCtx.destination);
			osc.start();
			osc.stop(audioCtx.currentTime + dur);
		} catch (e) { /* 音が出せなくても操作は続行 */ }
	}

	// ---- 答えを次の式の頭に変換(=の後に演算子を押したとき) ----
	function ansToTokens() {
		if (ans === null) return [];
		if (ans.k === "rat") {
			var neg = ans.n < 0n;
			var n = neg ? -ans.n : ans.n;
			if (String(n).length <= 10 && String(ans.d).length <= 10) {
				var seq = [];
				if (neg) seq.push({ t: "op", v: "-" });
				seq.push({ t: "num", s: String(n) });
				if (ans.d !== 1n) {
					seq.push({ t: "frac" });
					seq.push({ t: "num", s: String(ans.d) });
				}
				return seq;
			}
		}
		var s = Exact.formatDec(Exact.toNumber(ans));
		if (s === null) return [];
		if (s.charAt(0) === "-") return [{ t: "op", v: "-" }, { t: "num", s: s.slice(1) }];
		return [{ t: "num", s: s }];
	}

	function startFreshIfResult() {
		if (phase === "result") {
			tokens = [];
			phase = "input";
			errShown = false;
			insertAt = null;
		}
	}

	function continueFromAns() {
		// =の後に演算子系を押したら、答えを式の頭にして続きから
		if (phase === "result" && !errShown) {
			tokens = ansToTokens();
			phase = "input";
			insertAt = null;
		} else {
			startFreshIfResult();
		}
	}

	// 直前トークンが「これから数を置く場所」か(分数の穴埋めを始めてよいか)
	function operandExpected() {
		var tb = tokenBeforeCursor();
		return tb === null || tb.t === "op" || tb.t === "frac" || tb.t === "sqrt" || tb.t === "lp";
	}

	// ---- ゲーム選択画面(静的描画) ----
	function renderMenu() {
		lctx.fillStyle = GB[2];
		lctx.fillRect(0, 0, LCD_W, LCD_H);
		// 1 RUN / 2 FLY / 3 DUEL。人キーで電卓へ戻る
		// (PET は一旦メニューから外している。js/pet.js は残置=復活可能)
		drawSprite(lctx, DotSprites.RUN[0], 14, 4);
		DotFont.drawText(lctx, "1 RUN", 26, 4, GB[0]);
		drawSprite(lctx, DotSprites.FLY_DOWN, 14, 17);
		DotFont.drawText(lctx, "2 FLY", 26, 17, GB[0]);
		drawSprite(lctx, DotSprites.DUEL_IDLE, 14, 30);
		DotFont.drawText(lctx, "3 DUEL", 26, 30, GB[0]);
	}

	// ---- ゲームパッド(ゲーム中は電卓キーを隠して大ボタンに切り替え=誤タップ防止) ----
	var keysEl = document.getElementById("keys");
	var padEl = document.getElementById("gamepad");
	var PAD_ICONS = { left: "BTN_LEFT", right: "BTN_RIGHT", attack: "BTN_ATTACK", guard: "BTN_GUARD", act: "BTN_ACT", magic: "BTN_MAGIC" };

	function renderPadLabels() {
		var canvases = padEl.querySelectorAll("canvas.pad-label");
		for (var i = 0; i < canvases.length; i++) {
			var c = canvases[i];
			var icon = c.getAttribute("data-icon");
			c.width = 7;
			c.height = 9;
			// ゲームがアイコン差し替え(padIcons)を持っていれば優先(例: ペットはおにぎり)
			var name = (activeGame && activeGame.padIcons && activeGame.padIcons[icon]) || PAD_ICONS[icon];
			var g = icon === "exit" ? DotSprites.RUN[0] : DotSprites[name];
			var ctx2 = c.getContext("2d");
			ctx2.clearRect(0, 0, c.width, c.height);
			if (g) drawSprite(ctx2, g, 1, 1);
		}
	}

	function showPad(actions) {
		keysEl.style.display = "none";
		padEl.style.display = "grid";
		var btns = padEl.querySelectorAll("button.pad");
		for (var i = 0; i < btns.length; i++) {
			var a = btns[i].getAttribute("data-action");
			btns[i].style.display = (a === "exit" || actions.indexOf(a) !== -1) ? "" : "none";
		}
		renderPadLabels();
	}

	function hidePad() {
		padEl.style.display = "none";
		keysEl.style.display = "";
	}

	function startGame(game) {
		mode = "game";
		activeGame = game;
		showPad(game.pad || ["act"]);
		// refreshPad: ゲーム側でボタンが増えたとき(例: 魔法を習得)に呼んでもらう
		activeGame.start(lctx, LCD_W, LCD_H, {
			beep: beep,
			refreshPad: function () { showPad(activeGame.pad || ["act"]); }
		});
	}

	function padDown(action) {
		if (mode !== "game" || !activeGame) return;
		if (activeGame.inputDown) activeGame.inputDown(action);
		else activeGame.input();
	}

	function padUp(action) {
		if (mode !== "game" || !activeGame) return;
		if (activeGame.inputUp) activeGame.inputUp(action);
	}

	// ---- キー処理 ----
	function press(key) {
		// プレイ中: 人キー=選択画面に戻る。他のすべてのキーはアクション
		if (mode === "game") {
			if (key === "人") {
				activeGame.stop();
				hidePad();
				mode = "menu";
				renderMenu();
			} else {
				padDown("act");
			}
			return;
		}
		// 選択画面: 1=ランナー / 2=フラッピー / 3=チャンバラ / 人=電卓へ
		if (mode === "menu") {
			if (key === "人") {
				mode = "calc";
				beep(660, 0.06);
				render();
			} else if (key === "1") {
				beep(990, 0.06);
				startGame(DotGame);
			} else if (key === "2") {
				beep(990, 0.06);
				startGame(DotFlappy);
			} else if (key === "3") {
				beep(990, 0.06);
				startGame(DotDuel);
			}
			return;
		}
		if (key === "人") {
			mode = "menu";
			beep(1100, 0.08);
			renderMenu();
			return;
		}

		if (key >= "0" && key <= "9") {
			startFreshIfResult();
			var tb = tokenBeforeCursor();
			if (tb !== null && tb.t === "num") {
				if (tb.s.replace(".", "").length < 10) tb.s += key;
			} else {
				insertToken({ t: "num", s: key });
			}
			beep(880, 0.06);
		} else if (key === ".") {
			startFreshIfResult();
			var tb2 = tokenBeforeCursor();
			if (tb2 !== null && tb2.t === "num") {
				if (tb2.s.indexOf(".") === -1) tb2.s += ".";
			} else {
				insertToken({ t: "num", s: "0." });
			}
			beep(880, 0.06);
		} else if (key === "+" || key === "-" || key === "*" || key === "/") {
			continueFromAns();
			insertAt = null; // 演算子で穴埋めモードを抜ける
			tokens.push({ t: "op", v: key });
			beep(660, 0.07);
		} else if (key === "⁄") {
			if (insertAt !== null) {
				// 穴埋め中にもう一度⁄ → 分母の入力へ
				insertAt = null;
			} else {
				continueFromAns();
				if (operandExpected()) {
					// 数の前に⁄ → □/□ を置いて分子から穴埋め
					tokens.push({ t: "frac" });
					insertAt = tokens.length - 1;
				} else {
					tokens.push({ t: "frac" });
				}
			}
			beep(660, 0.07);
		} else if (key === "√") {
			startFreshIfResult();
			insertToken({ t: "sqrt" });
			beep(660, 0.07);
		} else if (key === "()") {
			startFreshIfResult();
			var which = Parser.smartParen(tokens.slice(0, cursorIndex()));
			insertToken({ t: which });
			beep(660, 0.07);
		} else if (key === "(") {
			startFreshIfResult();
			insertToken({ t: "lp" });
			beep(660, 0.07);
		} else if (key === ")") {
			startFreshIfResult();
			insertToken({ t: "rp" });
			beep(660, 0.07);
		} else if (key === "⌫") {
			if (phase === "result") {
				phase = "input"; // 答え表示から式の編集に戻る
				errShown = false;
				insertAt = null;
			} else if (insertAt !== null) {
				var prev = tokens[insertAt - 1];
				if (!prev || prev.t === "op") {
					// 分子が空 → 分数ごと消して穴埋め解除
					tokens.splice(insertAt, 1);
					insertAt = null;
				} else if (prev.t === "num" && prev.s.length > 1) {
					prev.s = prev.s.slice(0, -1);
				} else {
					tokens.splice(insertAt - 1, 1);
					insertAt--;
				}
			} else {
				var lt = tokens.length ? tokens[tokens.length - 1] : null;
				if (lt !== null && lt.t === "num" && lt.s.length > 1) lt.s = lt.s.slice(0, -1);
				else tokens.pop();
			}
			beep(440, 0.05);
		} else if (key === "=") {
			insertAt = null;
			if (tokens.length > 0) {
				try {
					var closed = Parser.autoClose(tokens);
					var tree = Parser.parse(closed, false);
					ans = Parser.evalNode(tree);
					tokens = closed;
					approx = Parser.hasDecimal(tokens) || ans.k === "dec";
					errShown = false;
					beep(1320, 0.09);
				} catch (e) {
					if (!e.calcError) throw e;
					ans = null;
					errShown = true;
					beep(220, 0.15);
				}
				phase = "result";
			}
		} else if (key === "≈") {
			if (phase === "result" && !errShown) {
				approx = !approx;
				beep(990, 0.06);
			}
		} else if (key === "C") {
			tokens = [];
			phase = "input";
			ans = null;
			errShown = false;
			approx = false;
			insertAt = null;
			beep(440, 0.07);
		}
		render();
	}

	// 電卓ボタン: pointerdownで即反応
	var keys = document.querySelectorAll("#keys button.key");
	for (var i = 0; i < keys.length; i++) {
		(function (btn) {
			btn.addEventListener("pointerdown", function (ev) {
				ev.preventDefault();
				press(btn.getAttribute("data-key"));
			});
			btn.addEventListener("click", function (ev) { ev.preventDefault(); });
		})(keys[i]);
	}

	// パッドボタン: 押す/離すの両方をゲームへ届ける(ガードや移動の押しっぱなし用)
	var pads = document.querySelectorAll("#gamepad button.pad");
	for (var j = 0; j < pads.length; j++) {
		(function (btn) {
			var action = btn.getAttribute("data-action");
			btn.addEventListener("pointerdown", function (ev) {
				ev.preventDefault();
				// 指がボタンから少しずれても「離した」と誤判定しないよう捕捉する
				// (ガードを押し続けている間に指が動いても外れない=多点タッチが安定)
				try { btn.setPointerCapture(ev.pointerId); } catch (e) {}
				if (action === "exit") press("人");
				else padDown(action);
			});
			var release = function (ev) {
				if (ev) ev.preventDefault();
				if (action !== "exit") padUp(action);
			};
			// pointerleave は使わない(捕捉中は指のずれで離れたことにしない)。
			// pointerup / pointercancel でのみ解放する
			btn.addEventListener("pointerup", release);
			btn.addEventListener("pointercancel", release);
			btn.addEventListener("click", function (ev) { ev.preventDefault(); });
		})(pads[j]);
	}

	// キーボードのキー→ゲーム操作の対応
	function keyToAction(k) {
		if (k === "ArrowLeft") return "left";
		if (k === "ArrowRight") return "right";
		if (k === "ArrowDown") return "guard";
		// スペース・Enter・その他は主アクション(チャンバラなら斬り)
		var main = (activeGame && activeGame.pad && activeGame.pad.indexOf("attack") !== -1) ? "attack" : "act";
		return main;
	}

	// キーボード(PC向け)。/は分数、rは√、gは棒人間。ゲーム中は←→↓とスペースで操作
	document.addEventListener("keydown", function (ev) {
		var k = ev.key;
		if (k === "g" || k === "G") k = "人";
		if (mode === "game") {
			if (k === "人") press("人");
			else if (!ev.repeat) padDown(keyToAction(ev.key));
			ev.preventDefault();
			return;
		}
		if (mode === "menu") {
			if (k === "人" || k === "1" || k === "2" || k === "3") press(k);
			ev.preventDefault();
			return;
		}
		if (k === "Enter") k = "=";
		else if (k === "Escape" || k === "Delete") k = "C";
		else if (k === "Backspace") k = "⌫";
		else if (k === "x" || k === "X") k = "*";
		else if (k === "/") k = "⁄";
		else if (k === "r" || k === "R") k = "√";
		if ("0123456789.+-*/=C()⁄√⌫≈人".indexOf(k) !== -1 && k !== "") {
			press(k);
			ev.preventDefault();
		}
	});

	document.addEventListener("keyup", function (ev) {
		if (mode !== "game") return;
		padUp(keyToAction(ev.key));
	});

	// 指2本でのピンチ拡大を止める(iOS Safari は user-scalable=no を無視するため JS でも抑止)。
	// ボタンはポインタイベントで動くので、これでゲームの多点タッチには影響しない。
	["gesturestart", "gesturechange", "gestureend"].forEach(function (t) {
		document.addEventListener(t, function (ev) { ev.preventDefault(); }, { passive: false });
	});
	document.addEventListener("touchmove", function (ev) {
		if (ev.touches && ev.touches.length > 1) ev.preventDefault();
	}, { passive: false });

	renderButtonLabels();
	render();

	// テスト・デバッグ用の窓口
	window.DENTAKU = {
		press: press,
		getTokens: function () { return JSON.parse(JSON.stringify(tokens)); },
		getAns: function () { return ans; },
		isError: function () { return errShown; },
		getPhase: function () { return phase; },
		getMode: function () { return mode; },
		getInsertAt: function () { return insertAt; }
	};
})();
