window.__ModuleLoader__.load({
	id: "dsh-music-v2",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.tsx
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/client/app.tsx
var import_react = require("react");

// src/shared/types.ts
function trackUrl(track) {
  if (track.source === "netease") {
    return `/dsh-music-v2/stream?source=netease&id=${encodeURIComponent(track.sourceId ?? "")}`;
  }
  if (track.source === "bilibili") {
    const cid = track.cid !== void 0 ? `&cid=${track.cid}` : "";
    return `/dsh-music-v2/stream?source=bilibili&bvid=${encodeURIComponent(track.bvid ?? "")}${cid}`;
  }
  return track.url ?? "";
}

// src/client/api.ts
var BASE = "/dsh-music-v2";
async function json(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.detail ?? body.error ?? `HTTP ${response.status}`);
  return body;
}
async function fetchState() {
  return json(await fetch(`${BASE}/state`, { cache: "no-store" }));
}
async function postCommand(command) {
  return json(
    await fetch(`${BASE}/command`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(command)
    })
  );
}
async function searchSongs(query) {
  const payload = await json(
    await fetch(`${BASE}/search?q=${encodeURIComponent(query)}`, { cache: "no-store" })
  );
  return payload.songs;
}
async function importPlaylist(id, play) {
  return json(
    await fetch(`${BASE}/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, play })
    })
  );
}
async function biliStatus() {
  return json(await fetch(`${BASE}/bili/status`, { cache: "no-store" }));
}
async function biliFolders() {
  const payload = await json(
    await fetch(`${BASE}/bili/folders`, { cache: "no-store" })
  );
  return payload.folders;
}
async function biliFolder(ref, pn = 1) {
  const query = new URLSearchParams({ ...ref.trim() !== "" ? { ref } : {}, pn: String(pn) });
  return json(await fetch(`${BASE}/bili/folder?${query.toString()}`, { cache: "no-store" }));
}
async function biliImport(ref, play = true) {
  return json(
    await fetch(`${BASE}/bili/import`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ref, play })
    })
  );
}
async function biliLoginCookie(cookie) {
  const response = await fetch(`${BASE}/bili/login/cookie`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ cookie })
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.user === void 0) throw new Error(payload.detail ?? payload.error ?? `\u767B\u5F55\u5931\u8D25\uFF08HTTP ${response.status}\uFF09`);
  return { user: payload.user };
}
async function saveBiliFolder(ref) {
  await fetch(`${BASE}/config`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ biliFolder: ref })
  });
}
async function postPosition(trackId, positionMs) {
  try {
    await fetch(`${BASE}/position`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ trackId, positionMs }),
      keepalive: true
    });
  } catch {
  }
}
function subscribeState(onState, onFallback) {
  let closed = false;
  let source;
  let timer;
  let failures = 0;
  const poll = () => {
    if (closed) return;
    fetchState().then((state) => onState(state)).catch(() => {
    });
  };
  const startPolling = () => {
    if (timer !== void 0) return;
    onFallback(true);
    poll();
    timer = window.setInterval(poll, 5e3);
  };
  const stopPolling = () => {
    if (timer === void 0) return;
    window.clearInterval(timer);
    timer = void 0;
    onFallback(false);
  };
  const connect = () => {
    if (closed) return;
    try {
      source = new EventSource(`${BASE}/events`);
    } catch {
      startPolling();
      return;
    }
    source.addEventListener("state", (event) => {
      if (closed) return;
      try {
        onState(JSON.parse(event.data));
        failures = 0;
        stopPolling();
      } catch {
      }
    });
    source.addEventListener("error", () => {
      source?.close();
      source = void 0;
      failures += 1;
      if (failures >= 2) startPolling();
      if (closed) return;
      window.setTimeout(() => {
        if (closed || source !== void 0) return;
        connect();
      }, 3e3);
    });
  };
  connect();
  poll();
  return () => {
    closed = true;
    stopPolling();
    source?.close();
  };
}

// src/client/app.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var STORE_OPEN = "dsh-music-v2:open";
var STORE_X = "dsh-music-v2:x";
var STORE_Y = "dsh-music-v2:y";
var STORE_BILI_REF = "dsh-music-v2:bili-ref";
var SOURCE_LABEL = { netease: "\u7F51\u6613\u4E91", bilibili: "B\u7AD9", direct: "\u76F4\u94FE" };
var MODE_LABEL = { list: "\u5217\u8868\u5FAA\u73AF", single: "\u5355\u66F2\u5FAA\u73AF", shuffle: "\u968F\u673A\u64AD\u653E" };
var MODE_NEXT = { list: "single", single: "shuffle", shuffle: "list" };
function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
  const total = Math.floor(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
function readPos() {
  try {
    const x = localStorage.getItem(STORE_X);
    const y = localStorage.getItem(STORE_Y);
    if (x === null || y === null) return null;
    const pos = { x: Number(x), y: Number(y) };
    return Number.isFinite(pos.x) && Number.isFinite(pos.y) ? pos : null;
  } catch {
    return null;
  }
}
function savePos(pos) {
  try {
    localStorage.setItem(STORE_X, String(Math.round(pos.x)));
    localStorage.setItem(STORE_Y, String(Math.round(pos.y)));
  } catch {
  }
}
function clampPos(pos, width, height) {
  return {
    x: Math.max(8, Math.min(window.innerWidth - width - 8, pos.x)),
    y: Math.max(8, Math.min(window.innerHeight - height - 8, pos.y))
  };
}
var QueueList = (0, import_react.memo)(function QueueList2({ queue, index, onPlay, onRemove, onPlayNext, onReorder }) {
  const [dragging, setDragging] = (0, import_react.useState)(null);
  const [over, setOver] = (0, import_react.useState)(null);
  if (queue.length === 0) return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-empty", children: "\u64AD\u653E\u5217\u8868\u4E3A\u7A7A\uFF0C\u641C\u7D22\u6216\u5BFC\u5165\u6B4C\u5355\u5427" });
  const drop = () => {
    if (dragging !== null && over !== null && dragging !== over) onReorder(dragging, over);
    setDragging(null);
    setOver(null);
  };
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)(import_jsx_runtime.Fragment, { children: queue.map((track, i) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
    "div",
    {
      className: `dm2-item${i === index ? " dm2-current" : ""}${dragging === i ? " dm2-dragging" : ""}${over === i && dragging !== null ? " dm2-drop" : ""}`,
      onClick: () => onPlay(i),
      title: `${track.title} \u2014 ${track.artist}\uFF08\u62D6\u52A8\u53EF\u6392\u5E8F\uFF09`,
      draggable: true,
      onDragStart: (event) => {
        setDragging(i);
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", String(i));
      },
      onDragOver: (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "move";
        setOver(i);
      },
      onDragLeave: () => setOver((current) => current === i ? null : current),
      onDrop: (event) => {
        event.preventDefault();
        drop();
      },
      onDragEnd: () => {
        setDragging(null);
        setOver(null);
      },
      children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dm2-grip", title: "\u62D6\u52A8\u6392\u5E8F", children: "\u22EE\u22EE" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dm2-item-title", children: [
          i === index ? "\u25B6 " : "",
          track.title
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dm2-item-sub", children: track.artist }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            className: "dm2-del",
            title: "\u4E0B\u4E00\u9996\u64AD\u653E",
            onClick: (event) => {
              event.stopPropagation();
              onPlayNext(i);
            },
            children: "\u23ED"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            className: "dm2-del",
            title: "\u4ECE\u961F\u5217\u79FB\u9664",
            onClick: (event) => {
              event.stopPropagation();
              onRemove(i);
            },
            children: "\xD7"
          }
        )
      ]
    },
    track.id
  )) });
});
function MusicOverlay() {
  const [state, setState] = (0, import_react.useState)(null);
  const [open, setOpen] = (0, import_react.useState)(() => localStorage.getItem(STORE_OPEN) === "1");
  const [pos, setPos] = (0, import_react.useState)(readPos);
  const [progress, setProgress] = (0, import_react.useState)(0);
  const [duration, setDuration] = (0, import_react.useState)(0);
  const [audioPaused, setAudioPaused] = (0, import_react.useState)(true);
  const [buffering, setBuffering] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)("");
  const [tab, setTab] = (0, import_react.useState)("queue");
  const [query, setQuery] = (0, import_react.useState)("");
  const [results, setResults] = (0, import_react.useState)(null);
  const [busy, setBusy] = (0, import_react.useState)(false);
  const [fallback, setFallback] = (0, import_react.useState)(false);
  const [confirmClear, setConfirmClear] = (0, import_react.useState)(false);
  const [bili, setBili] = (0, import_react.useState)(null);
  const [biliRef, setBiliRef] = (0, import_react.useState)(() => localStorage.getItem(STORE_BILI_REF) ?? "");
  const [biliData, setBiliData] = (0, import_react.useState)(null);
  const [biliFolderList, setBiliFolderList] = (0, import_react.useState)([]);
  const [biliBusy, setBiliBusy] = (0, import_react.useState)(false);
  const [biliError, setBiliError] = (0, import_react.useState)("");
  const [cookieDraft, setCookieDraft] = (0, import_react.useState)("");
  const biliLoadedRef = (0, import_react.useRef)(false);
  const audioRef = (0, import_react.useRef)(null);
  const loadedRef = (0, import_react.useRef)("");
  const cardRef = (0, import_react.useRef)(null);
  const dragRef = (0, import_react.useRef)(null);
  const stateRef = (0, import_react.useRef)(null);
  const errorSkipRef = (0, import_react.useRef)(0);
  const retryRef = (0, import_react.useRef)(0);
  const blobUrlRef = (0, import_react.useRef)(null);
  const blobAbortRef = (0, import_react.useRef)(null);
  const lastUserRef = (0, import_react.useRef)(0);
  const volumeTimerRef = (0, import_react.useRef)(void 0);
  const fileRef = (0, import_react.useRef)(null);
  stateRef.current = state;
  (0, import_react.useEffect)(() => {
    let alive = true;
    const dispose = subscribeState(
      (next) => {
        if (!alive) return;
        setState((prev) => prev !== null && next.rev < prev.rev ? prev : next);
      },
      (polling) => alive && setFallback(polling)
    );
    return () => {
      alive = false;
      dispose();
    };
  }, []);
  (0, import_react.useEffect)(() => {
    const audio = new Audio();
    audio.preload = "metadata";
    audioRef.current = audio;
    const onTime = () => setProgress(audio.currentTime);
    const onMeta = () => setDuration(Number.isFinite(audio.duration) ? audio.duration : 0);
    const onPlaying = () => {
      errorSkipRef.current = 0;
      retryRef.current = 0;
      setAudioPaused(false);
      setError("");
    };
    const onPlay = () => setAudioPaused(false);
    const onPause = () => setAudioPaused(true);
    const onEnded = () => {
      const current = stateRef.current;
      const track2 = current?.queue[current.index];
      if (track2 === void 0) return;
      postCommand({ action: "ended", trackId: track2.id }).then((result) => {
        setState(result.state);
        if (result.replay === true) {
          audio.currentTime = 0;
          void audio.play();
        }
      }).catch(() => setError("\u64AD\u653E\u670D\u52A1\u8FDE\u63A5\u5931\u8D25"));
    };
    const onError = () => {
      const current = stateRef.current;
      const track2 = current?.queue[current.index];
      const position = audio.currentTime;
      if (track2 !== void 0 && retryRef.current < 2) {
        retryRef.current += 1;
        setError("\u64AD\u653E\u4E2D\u65AD\uFF0C\u6B63\u5728\u91CD\u8BD5\u2026");
        setProgress(position);
        const restore = () => {
          try {
            audio.currentTime = position;
          } catch {
          }
          audio.removeEventListener("loadedmetadata", restore);
        };
        audio.addEventListener("loadedmetadata", restore);
        const base = trackUrl(track2);
        audio.src = `${base}${base.includes("?") ? "&" : "?"}retry=${Date.now()}`;
        audio.load();
        void audio.play().catch(() => void 0);
        return;
      }
      setError("\u64AD\u653E\u5931\u8D25\uFF1A\u97F3\u6E90\u4E0D\u53EF\u8FBE\u6216\u7248\u6743\u53D7\u9650\uFF0C\u53EF\u70B9\u64AD\u653E\u6309\u94AE\u91CD\u8BD5");
    };
    audio.addEventListener("timeupdate", onTime);
    audio.addEventListener("loadedmetadata", onMeta);
    audio.addEventListener("playing", onPlaying);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("error", onError);
    return () => {
      audio.pause();
      audio.removeEventListener("timeupdate", onTime);
      audio.removeEventListener("loadedmetadata", onMeta);
      audio.removeEventListener("playing", onPlaying);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("error", onError);
      blobAbortRef.current?.abort();
      if (blobUrlRef.current !== null) URL.revokeObjectURL(blobUrlRef.current);
      audioRef.current = null;
    };
  }, []);
  (0, import_react.useEffect)(() => {
    const audio = audioRef.current;
    if (audio === null) return;
    const track2 = state?.queue[state.index];
    if (state === null || track2 === void 0) {
      loadedRef.current = "";
      audio.pause();
      audio.removeAttribute("src");
      return;
    }
    audio.volume = state.volume;
    if (loadedRef.current !== track2.id) {
      loadedRef.current = track2.id;
      retryRef.current = 0;
      setProgress(state.positionMs / 1e3);
      setDuration((track2.durationMs ?? 0) / 1e3);
      const resumeAt = state.positionMs / 1e3;
      const start = (url) => {
        audio.src = url;
        audio.load();
        const onLoaded = () => {
          try {
            if (resumeAt > 0.5) audio.currentTime = resumeAt;
          } catch {
          }
          audio.removeEventListener("loadedmetadata", onLoaded);
        };
        audio.addEventListener("loadedmetadata", onLoaded);
        if (stateRef.current?.playing === true) {
          void audio.play().catch(() => void 0);
        }
      };
      if (blobUrlRef.current !== null) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
      blobAbortRef.current?.abort();
      blobAbortRef.current = null;
      const useBlob = track2.source === "bilibili" && (track2.durationMs ?? 0) < 20 * 6e4;
      if (useBlob) {
        const controller = new AbortController();
        blobAbortRef.current = controller;
        setBuffering(true);
        const streamUrl = trackUrl(track2);
        void fetch(streamUrl, { signal: controller.signal }).then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.blob();
        }).then((blob) => {
          if (controller.signal.aborted) return;
          const objectUrl = URL.createObjectURL(blob);
          blobUrlRef.current = objectUrl;
          start(objectUrl);
        }).catch(() => {
          if (!controller.signal.aborted) start(streamUrl);
        }).finally(() => {
          if (!controller.signal.aborted) setBuffering(false);
        });
      } else {
        start(trackUrl(track2));
      }
    } else if (state.playing && audio.paused) {
      audio.play().catch((reason) => {
        const name2 = reason instanceof DOMException ? reason.name : "";
        setError(name2 === "NotAllowedError" ? "\u6D4F\u89C8\u5668\u62E6\u622A\u4E86\u81EA\u52A8\u64AD\u653E\uFF0C\u70B9\u4E00\u4E0B\u64AD\u653E\u6309\u94AE" : "\u64AD\u653E\u5931\u8D25\uFF1A\u97F3\u9891\u6E90\u4E0D\u53EF\u8FBE");
      });
    } else if (!state.playing && !audio.paused) {
      audio.pause();
    }
  }, [state?.rev]);
  (0, import_react.useEffect)(() => {
    const timer = window.setInterval(() => {
      const audio = audioRef.current;
      const current = stateRef.current;
      const track2 = current?.queue[current.index];
      if (audio === null || current === null || track2 === void 0 || !current.playing) return;
      void postPosition(track2.id, Math.round(audio.currentTime * 1e3));
    }, 1e4);
    return () => window.clearInterval(timer);
  }, []);
  (0, import_react.useEffect)(() => {
    if (!("mediaSession" in navigator)) return;
    const track2 = state?.queue[state.index];
    if (track2 === void 0) return;
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: track2.title,
        artist: track2.artist,
        album: track2.album ?? "",
        artwork: track2.cover !== void 0 && track2.cover !== "" ? [{ src: track2.cover }] : []
      });
      navigator.mediaSession.setActionHandler("play", () => void run({ action: "play" }));
      navigator.mediaSession.setActionHandler("pause", () => void run({ action: "pause" }));
      navigator.mediaSession.setActionHandler("nexttrack", () => void run({ action: "next" }));
      navigator.mediaSession.setActionHandler("previoustrack", () => void run({ action: "prev" }));
    } catch {
    }
  }, [state?.queue[state.index]?.id]);
  const applyResult = (0, import_react.useCallback)((result) => {
    setState(result.state);
  }, []);
  const run = (0, import_react.useCallback)(
    async (command) => {
      lastUserRef.current = Date.now();
      try {
        applyResult(await postCommand(command));
      } catch {
        setError("\u64AD\u653E\u670D\u52A1\u8FDE\u63A5\u5931\u8D25\uFF0C\u7A0D\u540E\u91CD\u8BD5");
      }
    },
    [applyResult]
  );
  const playNow = (0, import_react.useCallback)(() => {
    const audio = audioRef.current;
    if (audio === null) return;
    void audio.play().then(() => setAudioPaused(false)).catch((reason) => {
      const name2 = reason instanceof DOMException ? reason.name : "";
      setError(name2 === "NotAllowedError" ? "\u6D4F\u89C8\u5668\u62E6\u622A\u4E86\u81EA\u52A8\u64AD\u653E\uFF0C\u70B9\u4E00\u4E0B\u64AD\u653E\u6309\u94AE" : "\u64AD\u653E\u5931\u8D25\uFF1A\u97F3\u6E90\u4E0D\u53EF\u8FBE\u6216\u683C\u5F0F\u4E0D\u652F\u6301");
    });
  }, []);
  const togglePlay = (0, import_react.useCallback)(() => {
    if (audioPaused) {
      playNow();
      void run({ action: "play" });
    } else {
      void run({ action: "pause" });
    }
  }, [audioPaused, playNow, run]);
  const onPointerDown = (0, import_react.useCallback)((event) => {
    if (event.button !== 0) return;
    const rect = cardRef.current?.getBoundingClientRect();
    if (rect === void 0) return;
    dragRef.current = { startX: event.clientX, startY: event.clientY, baseX: rect.left, baseY: rect.top, moved: false };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);
  const onPointerMove = (0, import_react.useCallback)((event) => {
    const drag = dragRef.current;
    if (drag === null) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
    drag.moved = true;
    const rect = cardRef.current?.getBoundingClientRect();
    const next = clampPos({ x: drag.baseX + dx, y: drag.baseY + dy }, rect?.width ?? 320, rect?.height ?? 120);
    setPos(next);
  }, []);
  const onPointerUp = (0, import_react.useCallback)(() => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.moved === true) {
      setPos((current) => {
        if (current !== null) savePos(current);
        return current;
      });
    }
  }, []);
  const toggleOpen = (0, import_react.useCallback)(() => {
    setOpen((prev) => {
      try {
        localStorage.setItem(STORE_OPEN, prev ? "0" : "1");
      } catch {
      }
      return !prev;
    });
  }, []);
  const seekTo = (0, import_react.useCallback)((ratio2) => {
    const audio = audioRef.current;
    if (audio === null || !Number.isFinite(audio.duration) || audio.duration <= 0) return;
    const time = Math.max(0, Math.min(audio.duration, ratio2 * audio.duration));
    audio.currentTime = time;
    setProgress(time);
    const track2 = stateRef.current?.queue[stateRef.current.index];
    if (track2 !== void 0) void postPosition(track2.id, Math.round(time * 1e3));
  }, []);
  const onVolume = (0, import_react.useCallback)(
    (value) => {
      const audio = audioRef.current;
      if (audio !== null) audio.volume = value;
      setState((prev) => prev === null ? prev : { ...prev, volume: value });
      window.clearTimeout(volumeTimerRef.current);
      volumeTimerRef.current = window.setTimeout(() => void run({ action: "volume", volume: value }), 180);
    },
    [run]
  );
  const doSearch = (0, import_react.useCallback)(async () => {
    const value = query.trim();
    if (value === "") return;
    setBusy(true);
    setError("");
    try {
      setResults(await searchSongs(value));
    } catch (reason) {
      setResults([]);
      setError(`\u641C\u7D22\u5931\u8D25\uFF1A${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  }, [query]);
  const addAndPlay = (0, import_react.useCallback)(
    async (row) => {
      const track2 = {
        id: `netease:${row.id}`,
        title: row.title,
        artist: row.artist,
        album: row.album,
        cover: row.cover,
        durationMs: row.durationMs,
        source: "netease",
        sourceId: row.id
      };
      try {
        const added = await postCommand({ action: "add", track: track2 });
        applyResult(added);
        await run({ action: "play", index: added.state.queue.findIndex((item) => item.id === track2.id) });
      } catch {
        setError("\u52A0\u5165\u64AD\u653E\u5217\u8868\u5931\u8D25");
      }
    },
    [applyResult, run]
  );
  const addLocalFiles = (0, import_react.useCallback)(
    async (files) => {
      if (files === null || files.length === 0) return;
      for (const file of Array.from(files)) {
        const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        const track2 = {
          id: `direct:${stamp}`,
          title: file.name.replace(/\.[a-z0-9]+$/i, ""),
          artist: "\u672C\u5730\u6587\u4EF6",
          source: "direct",
          url: URL.createObjectURL(file)
        };
        try {
          applyResult(await postCommand({ action: "add", track: track2 }));
        } catch {
          setError("\u6DFB\u52A0\u672C\u5730\u6587\u4EF6\u5931\u8D25");
          return;
        }
      }
      setTab("queue");
    },
    [applyResult]
  );
  const playNext = (0, import_react.useCallback)(
    (index) => {
      const current = stateRef.current;
      if (current === null || index === current.index) return;
      const afterRemovalCurrent = current.index - (index < current.index ? 1 : 0);
      const to = Math.min(current.queue.length - 1, afterRemovalCurrent + 1);
      if (to === index) return;
      void run({ action: "reorder", from: index, to });
    },
    [run]
  );
  const doImport = (0, import_react.useCallback)(async () => {
    const value = query.trim();
    if (value === "") return;
    setBusy(true);
    setError("");
    try {
      const result = await importPlaylist(value, true);
      applyResult(result);
      setQuery("");
      setResults(null);
      setTab("queue");
    } catch (reason) {
      setError(`\u5BFC\u5165\u5931\u8D25\uFF1A${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  }, [query, applyResult]);
  const resolveBiliRef = (0, import_react.useCallback)(async (raw) => {
    const value = raw.trim();
    if (value === "" || /^https?:\/\//i.test(value) || /^\d+$/.test(value)) return value;
    const folders = await biliFolders();
    const needle = value.toLowerCase();
    const hit = folders.find((folder) => folder.title.toLowerCase() === needle) ?? folders.find((folder) => folder.title.toLowerCase().includes(needle));
    if (hit === void 0) {
      throw new Error(`\u627E\u4E0D\u5230\u6536\u85CF\u5939\u300C${value}\u300D\uFF0C\u53EF\u7528\uFF1A${folders.map((folder) => folder.title).join("\u3001") || "\uFF08\u65E0\uFF09"}`);
    }
    return `https://space.bilibili.com/0/favlist?fid=${hit.id}`;
  }, []);
  const loadBili = (0, import_react.useCallback)(
    async (ref) => {
      setBiliBusy(true);
      setBiliError("");
      try {
        const target = await resolveBiliRef(ref);
        const data = await biliFolder(target, 1);
        setBiliData(data);
        if (ref.trim() !== "") {
          setBiliRef(ref);
          localStorage.setItem(STORE_BILI_REF, ref);
          void saveBiliFolder(target).catch(() => void 0);
        }
      } catch (reason) {
        setBiliData(null);
        setBiliError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        setBiliBusy(false);
      }
    },
    [resolveBiliRef]
  );
  const refreshBili = (0, import_react.useCallback)(async () => {
    setBiliBusy(true);
    setBiliError("");
    try {
      const current = await biliStatus();
      setBili(current);
      if (current.loggedIn) {
        const ref = biliRef.trim() !== "" ? biliRef : current.folder ?? "";
        if (ref.trim() !== "") await loadBili(ref);
        else {
          try {
            setBiliFolderList(await biliFolders());
          } catch {
          }
        }
      }
    } catch (reason) {
      setBili({ loggedIn: false });
      setBiliError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBiliBusy(false);
    }
  }, [biliRef, loadBili]);
  const saveCookie = (0, import_react.useCallback)(async () => {
    const value = cookieDraft.trim();
    if (value === "") return;
    setBiliBusy(true);
    try {
      await biliLoginCookie(value);
      setCookieDraft("");
      await refreshBili();
    } catch (reason) {
      setBiliError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBiliBusy(false);
    }
  }, [cookieDraft, refreshBili]);
  const playBiliAll = (0, import_react.useCallback)(async () => {
    const ref = biliRef.trim();
    if (ref === "") {
      setBiliError("\u5148\u7C98\u8D34\u6536\u85CF\u5939\u94FE\u63A5\u6216 id");
      return;
    }
    setBiliBusy(true);
    setBiliError("");
    try {
      applyResult(await biliImport(ref, true));
    } catch (reason) {
      setBiliError(`\u8F7D\u5165\u5931\u8D25\uFF1A${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBiliBusy(false);
    }
  }, [biliRef, applyResult]);
  const playBiliTrack = (0, import_react.useCallback)(
    async (item) => {
      const ref = biliRef.trim();
      if (ref === "") return;
      setBiliBusy(true);
      try {
        const imported = await biliImport(ref, false);
        applyResult(imported);
        const index = imported.state.queue.findIndex((entry) => entry.id === item.id);
        if (index >= 0) await run({ action: "play", index });
      } catch (reason) {
        setBiliError(`\u64AD\u653E\u5931\u8D25\uFF1A${reason instanceof Error ? reason.message : String(reason)}`);
      } finally {
        setBiliBusy(false);
      }
    },
    [biliRef, applyResult, run]
  );
  const addBiliTrack = (0, import_react.useCallback)(
    async (item, next) => {
      try {
        applyResult(await postCommand({ action: "add", track: item, ...next ? { next: true } : {} }));
      } catch (reason) {
        setBiliError(`\u52A0\u5165\u961F\u5217\u5931\u8D25\uFF1A${reason instanceof Error ? reason.message : String(reason)}`);
      }
    },
    [applyResult]
  );
  (0, import_react.useEffect)(() => {
    if (tab !== "bili" || biliLoadedRef.current) return;
    biliLoadedRef.current = true;
    void refreshBili();
  }, [tab, refreshBili]);
  const track = state?.queue[state.index] ?? null;
  const queue = state?.queue ?? [];
  const volume = state?.volume ?? 0.8;
  const ratio = duration > 0 ? Math.min(1, progress / duration) : 0;
  const cardStyle = (0, import_react.useMemo)(
    () => pos !== null ? { left: pos.x, top: pos.y } : { right: 24, bottom: 92 },
    [pos]
  );
  return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-root", style: cardStyle, children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: `dm2-card${open ? "" : " dm2-mini"}`, ref: cardRef, tabIndex: -1, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        className: "dm2-header",
        onPointerDown,
        onPointerMove,
        onPointerUp,
        onDoubleClick: toggleOpen,
        title: "\u62D6\u52A8\u79FB\u52A8\uFF1B\u53CC\u51FB\u5C55\u5F00/\u6536\u8D77",
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-cover", children: track?.cover !== void 0 && track.cover !== "" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { src: track.cover, alt: "", draggable: false }) : "\u266A" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dm2-meta", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-title", children: track?.title ?? "\u672A\u5728\u64AD\u653E" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-artist", children: track ? `${track.artist}${track.source !== void 0 ? ` \xB7 ${SOURCE_LABEL[track.source] ?? track.source}` : ""}${buffering ? " \xB7 \u7F13\u51B2\u4E2D\u2026" : ""}` : "\u70B9\u5F00\u641C\u7D22\u4E00\u9996\u6B4C" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              className: "dm2-icon",
              title: audioPaused ? "\u64AD\u653E" : "\u6682\u505C",
              onClick: (event) => {
                event.stopPropagation();
                togglePlay();
              },
              onPointerDown: (event) => event.stopPropagation(),
              children: state?.playing === true ? "\u275A\u275A" : "\u25B6"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              className: "dm2-icon",
              title: open ? "\u6536\u8D77" : "\u5C55\u5F00",
              onClick: (event) => {
                event.stopPropagation();
                toggleOpen();
              },
              onPointerDown: (event) => event.stopPropagation(),
              children: open ? "\u25BE" : "\u25B4"
            }
          )
        ]
      }
    ),
    open && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dm2-body", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dm2-row", style: { marginTop: 2 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dm2-time", children: formatTime(progress) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "div",
          {
            className: "dm2-progress",
            title: "\u70B9\u51FB\u6216\u62D6\u52A8\u8C03\u6574\u8FDB\u5EA6",
            onPointerDown: (event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const seek = (clientX) => seekTo(Math.min(1, Math.max(0, (clientX - rect.left) / rect.width)));
              seek(event.clientX);
              const move = (moveEvent) => seek(moveEvent.clientX);
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            },
            children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-fill", style: { width: `${ratio * 100}%` } })
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dm2-time", children: formatTime(duration) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dm2-controls", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dm2-icon", title: "\u4E0A\u4E00\u9996", onClick: () => void run({ action: "prev" }), children: "\u23EE" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dm2-icon dm2-play", title: audioPaused ? "\u64AD\u653E" : "\u6682\u505C", onClick: togglePlay, children: audioPaused ? "\u25B6" : "\u275A\u275A" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dm2-icon", title: "\u4E0B\u4E00\u9996", onClick: () => void run({ action: "next" }), children: "\u23ED" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            className: "dm2-icon",
            title: `\u6A21\u5F0F\uFF1A${MODE_LABEL[state?.mode ?? "list"]}\uFF08\u70B9\u51FB\u5207\u6362\uFF09`,
            onClick: () => void run({ action: "mode", mode: MODE_NEXT[state?.mode ?? "list"] }),
            children: state?.mode === "shuffle" ? "\u{1F500}" : state?.mode === "single" ? "\u{1F501}\xB9" : "\u{1F501}"
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dm2-row", style: { marginTop: 8 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dm2-icon", style: { cursor: "default" }, children: "\u{1F508}" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            className: "dm2-slider",
            type: "range",
            min: 0,
            max: 1,
            step: 0.02,
            value: volume,
            onChange: (event) => onVolume(Number(event.target.value)),
            title: "\u97F3\u91CF"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dm2-tag", children: MODE_LABEL[state?.mode ?? "list"] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dm2-row", style: { marginTop: 10, gap: 6 }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "button",
          {
            className: "dm2-icon",
            style: { width: "auto", padding: "0 8px", fontSize: 11 },
            onClick: () => setTab("queue"),
            children: [
              "\u961F\u5217 ",
              queue.length
            ]
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            className: "dm2-icon",
            style: { width: "auto", padding: "0 8px", fontSize: 11 },
            onClick: () => setTab("search"),
            children: "\u641C\u7D22 / \u6B4C\u5355"
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "button",
          {
            className: "dm2-icon",
            style: { width: "auto", padding: "0 8px", fontSize: 11 },
            onClick: () => setTab("bili"),
            children: "B \u7AD9"
          }
        ),
        fallback && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dm2-tag", title: "SSE \u4E0D\u53EF\u7528\uFF0C\u5DF2\u964D\u7EA7\u8F6E\u8BE2", children: "\u8F6E\u8BE2" })
      ] }),
      tab === "queue" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dm2-row dm2-queue-head", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dm2-tag", children: [
            "\u5171 ",
            queue.length,
            " \u9996"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              className: "dm2-del",
              title: "\u6E05\u7A7A\u64AD\u653E\u961F\u5217",
              onClick: () => {
                if (!confirmClear) {
                  setConfirmClear(true);
                  window.setTimeout(() => setConfirmClear(false), 3e3);
                  return;
                }
                setConfirmClear(false);
                void run({ action: "clear" });
              },
              children: confirmClear ? "\u786E\u8BA4\u6E05\u7A7A\uFF1F" : "\u6E05\u7A7A"
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-list", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          QueueList,
          {
            queue,
            index: state?.index ?? 0,
            onPlay: (index) => void run({ action: "play", index }),
            onRemove: (index) => void run({ action: "remove", index }),
            onPlayNext: playNext,
            onReorder: (from, to) => void run({ action: "reorder", from, to })
          }
        ) })
      ] }) : tab === "search" ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dm2-search", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              className: "dm2-input",
              placeholder: "\u6B4C\u540D/\u6B4C\u624B\uFF0C\u6216\u6B4C\u5355 id/\u94FE\u63A5",
              value: query,
              onChange: (event) => setQuery(event.target.value),
              onKeyDown: (event) => {
                if (event.key !== "Enter") return;
                if (/^\d+$|music\.163\.com/.test(query.trim())) void doImport();
                else void doSearch();
              }
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dm2-icon", title: "\u641C\u7D22", disabled: busy, onClick: () => void doSearch(), children: "\u{1F50D}" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dm2-icon", title: "\u5BFC\u5165\u6B4C\u5355", disabled: busy, onClick: () => void doImport(), children: "\uFF0B" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dm2-icon", title: "\u64AD\u653E\u672C\u5730\u6587\u4EF6", onClick: () => fileRef.current?.click(), children: "\u{1F4C1}" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          "input",
          {
            ref: fileRef,
            type: "file",
            accept: "audio/*",
            multiple: true,
            style: { display: "none" },
            onChange: (event) => {
              void addLocalFiles(event.target.files);
              event.target.value = "";
            }
          }
        ),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-list", children: busy ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-empty", children: "\u5904\u7406\u4E2D\u2026" }) : results === null ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-empty", children: "\u8F93\u5165\u5173\u952E\u8BCD\u641C\u7D22\uFF0C\u6216\u7C98\u8D34\u7F51\u6613\u4E91\u6B4C\u5355\u94FE\u63A5\u5BFC\u5165" }) : results.length === 0 ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-empty", children: "\u6CA1\u6709\u7ED3\u679C" }) : results.map((row) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dm2-item", onClick: () => void addAndPlay(row), title: "\u52A0\u5165\u5E76\u64AD\u653E", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dm2-item-title", children: row.title }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dm2-item-sub", children: row.artist })
        ] }, row.id)) })
      ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dm2-row", style: { marginTop: 8, gap: 6 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dm2-tag", title: bili?.source !== void 0 ? `\u767B\u5F55\u6001\u6765\u6E90\uFF1A${bili.source}` : "", children: bili?.loggedIn === true ? `B\u7AD9\uFF1A${bili.user?.name ?? "\u5DF2\u767B\u5F55"}` : "B\u7AD9\u672A\u767B\u5F55" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dm2-del", title: "\u5237\u65B0 B \u7AD9\u72B6\u6001", onClick: () => void refreshBili(), children: "\u5237\u65B0" }),
          biliBusy && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dm2-tag", children: "\u8F7D\u5165\u4E2D\u2026" })
        ] }),
        bili?.loggedIn !== true ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-note", children: "\u81EA\u52A8\u590D\u7528\u672C\u673A bili CLI / bili-whale \u7684\u767B\u5F55\u6001\uFF1B\u4E5F\u53EF\u4EE5\u76F4\u63A5\u7C98\u8D34 Cookie \u767B\u5F55\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dm2-search", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                className: "dm2-input",
                placeholder: "SESSDATA \u7684\u503C\u6216\u6574\u6BB5 Cookie",
                value: cookieDraft,
                onChange: (event) => setCookieDraft(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter") void saveCookie();
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dm2-icon", title: "\u6821\u9A8C\u5E76\u4FDD\u5B58 Cookie", onClick: () => void saveCookie(), children: "\u767B\u5F55" })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-note", children: "\u83B7\u53D6\uFF1A\u6D4F\u89C8\u5668\u767B\u5F55 bilibili.com \u2192 F12 \u2192 Application \u2192 Cookies \u2192 https://www.bilibili.com \u2192 \u590D\u5236 SESSDATA \u7684\u503C\uFF08HttpOnly\uFF0Cdocument.cookie \u53D6\u4E0D\u5230\uFF09\u3002" })
        ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dm2-search", children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
              "input",
              {
                className: "dm2-input",
                placeholder: "\u6536\u85CF\u5939\u94FE\u63A5 / id / \u540D\u79F0\uFF08\u5982 music\uFF09",
                value: biliRef,
                onChange: (event) => setBiliRef(event.target.value),
                onKeyDown: (event) => {
                  if (event.key === "Enter") void loadBili(biliRef);
                }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dm2-icon", title: "\u8F7D\u5165\u6536\u85CF\u5939", onClick: () => void loadBili(biliRef), children: "\u21BB" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dm2-icon", title: "\u64AD\u653E\u5168\u90E8\uFF08\u66FF\u6362\u961F\u5217\uFF09", onClick: () => void playBiliAll(), children: "\u25B6" })
          ] }),
          biliData === null && biliFolderList.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-bili-folders", children: biliFolderList.map((folder) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
            "button",
            {
              className: "dm2-tag dm2-bili-chip",
              title: `${folder.title}\uFF08${folder.count}\uFF09`,
              onClick: () => {
                const ref = `https://space.bilibili.com/${bili?.user?.mid ?? ""}/favlist?fid=${folder.id}`;
                setBiliRef(ref);
                void loadBili(ref);
              },
              children: [
                folder.title,
                " ",
                folder.count
              ]
            },
            folder.id
          )) }),
          biliData !== null ? /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-row dm2-queue-head", children: /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { className: "dm2-tag", children: [
              biliData.folder.title,
              " \xB7 ",
              biliData.folder.count,
              " \u9996"
            ] }) }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-list", children: biliData.tracks.map((item) => /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
              "div",
              {
                className: "dm2-item dm2-bili-row",
                title: "\u70B9\u51FB\u64AD\u653E\uFF08\u66FF\u6362\u961F\u5217\uFF09",
                onClick: () => void playBiliTrack(item),
                children: [
                  typeof item.cover === "string" && item.cover !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("img", { className: "dm2-bili-cover", src: item.cover, alt: "", loading: "lazy" }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dm2-item-title", children: item.title }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dm2-item-sub", children: item.artist }),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      className: "dm2-del",
                      title: "\u52A0\u5165\u961F\u5217",
                      onClick: (event) => {
                        event.stopPropagation();
                        void addBiliTrack(item, false);
                      },
                      children: "\uFF0B"
                    }
                  ),
                  /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
                    "button",
                    {
                      className: "dm2-del",
                      title: "\u4E0B\u4E00\u9996\u64AD\u653E",
                      onClick: (event) => {
                        event.stopPropagation();
                        void addBiliTrack(item, true);
                      },
                      children: "\u23ED"
                    }
                  )
                ]
              },
              item.id
            )) })
          ] }) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-empty", children: biliBusy ? "\u8BFB\u53D6\u6536\u85CF\u5939\u2026" : "\u7C98\u8D34\u6536\u85CF\u5939\u94FE\u63A5\u540E\u70B9 \u21BB\uFF0C\u6216\u70B9\u4E0A\u9762\u7684\u6536\u85CF\u5939" })
        ] }),
        biliError !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-error", onClick: () => setBiliError(""), title: "\u70B9\u51FB\u5173\u95ED", children: biliError })
      ] }),
      error !== "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dm2-error", onClick: () => setError(""), title: "\u70B9\u51FB\u5173\u95ED", children: error })
    ] })
  ] }) });
}

// src/client/styles.ts
var CSS = `
.dm2-root{position:fixed;z-index:60;font-family:inherit;color:var(--dsw-alias-label-primary,#f4f4f5);pointer-events:auto}
.dm2-card{width:320px;border-radius:16px;background:color-mix(in srgb,var(--dsw-alias-bg-base,#14161d) 88%,transparent);border:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.14));box-shadow:0 18px 48px rgba(0,0,0,.28);backdrop-filter:blur(18px) saturate(140%);-webkit-backdrop-filter:blur(18px) saturate(140%);overflow:hidden;transition:width .22s cubic-bezier(.22,1,.36,1)}
.dm2-header{display:flex;align-items:center;gap:10px;padding:10px 12px;cursor:grab;user-select:none}
.dm2-header:active{cursor:grabbing}
.dm2-cover{flex:none;width:38px;height:38px;border-radius:10px;overflow:hidden;background:linear-gradient(135deg,var(--dsw-alias-state-business-primary,#5b8cff),#8b5cf6);display:flex;align-items:center;justify-content:center;font-size:17px}
.dm2-cover img{width:100%;height:100%;object-fit:cover;display:block}
.dm2-meta{flex:1;min-width:0}
.dm2-title{font-size:13px;font-weight:600;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dm2-artist{font-size:11px;line-height:15px;color:var(--dsw-alias-label-tertiary,#9aa0ae);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dm2-icon{flex:none;width:28px;height:28px;border:none;border-radius:8px;background:transparent;color:inherit;display:inline-flex;align-items:center;justify-content:center;cursor:pointer;padding:0;opacity:.85}
.dm2-icon:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.08));opacity:1}
.dm2-play{width:34px;height:34px;border-radius:50%;background:var(--dsw-alias-label-primary,#f4f4f5);color:var(--dsw-alias-bg-base,#14161d);opacity:1}
.dm2-play:hover{filter:brightness(.94);background:var(--dsw-alias-label-primary,#f4f4f5)}
.dm2-body{padding:0 12px 12px}
.dm2-row{display:flex;align-items:center;gap:8px}
.dm2-progress{position:relative;flex:1;height:4px;border-radius:2px;background:var(--dsw-alias-border-l2,rgba(255,255,255,.18));cursor:pointer}
.dm2-fill{position:absolute;inset:0 auto 0 0;border-radius:2px;background:var(--dsw-alias-label-primary,#f4f4f5)}
.dm2-time{flex:none;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#9aa0ae);font-variant-numeric:tabular-nums}
.dm2-controls{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px}
.dm2-slider{flex:1;accent-color:var(--dsw-alias-state-business-primary,#5b8cff);height:4px;cursor:pointer}
.dm2-list{max-height:190px;overflow:auto;margin-top:10px;border-top:1px solid var(--dsw-alias-border-l1,rgba(255,255,255,.1));padding-top:6px;scrollbar-width:thin}
.dm2-item{display:flex;align-items:center;gap:8px;padding:5px 6px;border-radius:8px;font-size:12px;line-height:17px;cursor:pointer}
.dm2-item:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.07))}
.dm2-item.dm2-current{background:color-mix(in srgb,var(--dsw-alias-state-business-primary,#5b8cff) 18%,transparent)}
.dm2-item.dm2-dragging{opacity:.45}
.dm2-item.dm2-drop{box-shadow:inset 0 2px 0 var(--dsw-alias-state-business-primary,#5b8cff)}
.dm2-grip{flex:none;cursor:grab;color:var(--dsw-alias-label-caption,#7d8494);font-size:11px;letter-spacing:-1px;user-select:none}
.dm2-grip:active{cursor:grabbing}
.dm2-queue-head{justify-content:space-between;margin-top:8px}
.dm2-bili-folders{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px}
.dm2-bili-chip{border:none;cursor:pointer;font-size:10px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dm2-bili-chip:hover{filter:brightness(1.3)}
.dm2-bili-row{gap:6px}
.dm2-bili-cover{flex:none;width:42px;height:26px;border-radius:4px;object-fit:cover;background:var(--dsw-alias-bg-base,#14161d)}
.dm2-bili-row .dm2-item-title{font-size:11.5px}
.dm2-bili-row .dm2-item-sub{max-width:30%}
.dm2-item-title{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dm2-item-sub{flex:none;max-width:38%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,#9aa0ae);font-size:10.5px}
.dm2-del{flex:none;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#9aa0ae);cursor:pointer;padding:2px 4px;border-radius:6px;font-size:13px;line-height:1}
.dm2-del:hover{color:var(--dsw-alias-state-error-primary,#ff6b6b);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ff6b6b) 14%,transparent)}
.dm2-search{display:flex;gap:6px;margin-top:10px}
.dm2-input{flex:1;min-width:0;background:var(--dsw-alias-bg-base,#14161d);border:1px solid var(--dsw-alias-border-l2,rgba(255,255,255,.2));border-radius:8px;color:var(--dsw-alias-label-primary,#f4f4f5);font-size:12px;padding:6px 8px;outline:none}
.dm2-input:focus{border-color:var(--dsw-alias-state-business-primary,#5b8cff)}
.dm2-input::placeholder{color:var(--dsw-alias-label-caption,#7d8494)}
.dm2-empty{padding:12px 0;text-align:center;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#9aa0ae)}
.dm2-error{margin-top:8px;padding:6px 9px;border-radius:8px;font-size:11px;line-height:15px;color:var(--dsw-alias-state-error-primary,#ff6b6b);background:color-mix(in srgb,var(--dsw-alias-state-error-primary,#ff6b6b) 12%,transparent);cursor:pointer}
.dm2-tag{font-size:10px;padding:1px 5px;border-radius:999px;background:color-mix(in srgb,var(--dsw-alias-label-primary,#fff) 12%,transparent);color:var(--dsw-alias-label-secondary,#c3c7d0)}
.dm2-mini .dm2-body{display:none}
.dm2-mini{width:260px}
@media (max-width:520px){.dm2-card{width:min(320px,calc(100vw - 24px))}}
@media (prefers-reduced-motion:reduce){.dm2-card{transition:none}}
`;

// src/client/index.tsx
var name = "dsh-music-v2";
var inject = ["slots"];
var STYLE_ID = "dsh-music-v2/styles";
function ensureStyles() {
  if (document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`) !== null) return;
  const tag = document.createElement("style");
  tag.dataset.plugin = "dsh-music-v2";
  tag.dataset.pluginCss = STYLE_ID;
  tag.textContent = CSS;
  document.head.appendChild(tag);
}
function apply(ctx) {
  ensureStyles();
  ctx.slots.inject(
    "shell.overlay",
    () => ctx.slots.register(
      {
        name: "shell.overlay",
        id: "dsh-music-v2",
        order: 40
      },
      MusicOverlay
    )
  );
}

		return module.exports;
	}
});
