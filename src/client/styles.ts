/** Player stylesheet: DSH design tokens with sane fallbacks, dark/light aware. */
export const CSS = `
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
