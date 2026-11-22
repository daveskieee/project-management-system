/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  AlertTriangle,
  CheckCircle2,
  Info,
  Trash2,
  X,
  XCircle,
  MessageSquarePlus,
} from 'lucide-react';
import { useTheme } from './ThemeContext';

export type ConfirmVariant = 'danger' | 'warning' | 'primary';
export type ToastType = 'info' | 'success' | 'warning' | 'error';

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
}

export interface PromptOptions {
  title: string;
  message?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ConfirmDialogContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  prompt: (options: PromptOptions) => Promise<string | null>;
  toast: (message: string, type?: ToastType) => void;
}

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | undefined>(undefined);

export const ConfirmDialogProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { resolvedTheme } = useTheme();
  const isLight = resolvedTheme === 'light';
  const isNight = resolvedTheme === 'night';

  // Confirm modal state
  const [confirmState, setConfirmState] = useState<ConfirmOptions | null>(null);
  const confirmResolverRef = useRef<((result: boolean) => void) | null>(null);

  // Prompt modal state
  const [promptState, setPromptState] = useState<PromptOptions | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const promptResolverRef = useRef<((result: string | null) => void) | null>(null);
  const promptInputRef = useRef<HTMLInputElement | null>(null);

  // Toast stack
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      confirmResolverRef.current = resolve;
      setConfirmState(options);
    });
  }, []);

  const closeConfirm = useCallback((result: boolean) => {
    const resolver = confirmResolverRef.current;
    confirmResolverRef.current = null;
    setConfirmState(null);
    if (resolver) resolver(result);
  }, []);

  const prompt = useCallback((options: PromptOptions): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      promptResolverRef.current = resolve;
      setPromptValue(options.defaultValue ?? '');
      setPromptState(options);
    });
  }, []);

  const closePrompt = useCallback((result: string | null) => {
    const resolver = promptResolverRef.current;
    promptResolverRef.current = null;
    setPromptState(null);
    setPromptValue('');
    if (resolver) resolver(result);
  }, []);

  const toast = useCallback((message: string, type: ToastType = 'info') => {
    const id = `toast-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    setToasts((prev) => [...prev.slice(-4), { id, message, type }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3500);
  }, []);

  // Auto-focus prompt input
  useEffect(() => {
    if (promptState) {
      const timer = window.setTimeout(() => {
        promptInputRef.current?.focus();
      }, 40);
      return () => window.clearTimeout(timer);
    }
  }, [promptState]);

  // Escape key to cancel active dialog
  useEffect(() => {
    if (!confirmState && !promptState) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (promptState) closePrompt(null);
        else if (confirmState) closeConfirm(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [confirmState, promptState, closeConfirm, closePrompt]);

  // Theme surface classes for Light, Dark, and Night/Obsidian
  const modalSurface = isLight
    ? 'bg-white border-slate-200 text-slate-900 shadow-2xl'
    : isNight
    ? 'bg-[#09090b] border-zinc-800 text-zinc-100 shadow-2xl'
    : 'bg-slate-900 border-slate-700/90 text-slate-100 shadow-2xl';

  const modalMutedText = isLight ? 'text-slate-600' : isNight ? 'text-zinc-400' : 'text-slate-300';
  const cancelBtnCls = isLight
    ? 'bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-200'
    : isNight
    ? 'bg-zinc-900 hover:bg-zinc-800 text-zinc-300 border border-zinc-800'
    : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700';

  const inputSurface = isLight
    ? 'bg-white border-slate-300 text-slate-900 placeholder:text-slate-400 focus:border-amber-500'
    : isNight
    ? 'bg-zinc-950 border-zinc-700 text-zinc-100 placeholder:text-zinc-500 focus:border-amber-500'
    : 'bg-slate-950 border-slate-700 text-white placeholder:text-slate-500 focus:border-amber-500';

  const variant = confirmState?.variant ?? 'primary';

  const confirmBtnCls =
    variant === 'danger'
      ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-sm shadow-rose-600/20'
      : variant === 'warning'
      ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-sm shadow-amber-500/20'
      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-sm shadow-emerald-600/20';

  const iconBadgeCls =
    variant === 'danger'
      ? 'bg-rose-500/15 border-rose-500/30 text-rose-500'
      : variant === 'warning'
      ? 'bg-amber-500/15 border-amber-500/30 text-amber-500'
      : 'bg-emerald-500/15 border-emerald-500/30 text-emerald-500';

  return (
    <ConfirmDialogContext.Provider value={{ confirm, prompt, toast }}>
      {children}

      {/* Confirmation Dialog Portal */}
      {confirmState &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fadeIn"
            onClick={() => closeConfirm(false)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="confirm-dialog-title"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-md rounded-2xl border p-5 sm:p-6 transition-all ${modalSurface}`}
            >
              <div className="flex items-start gap-3.5">
                <div className={`w-10 h-10 rounded-xl border flex items-center justify-center shrink-0 ${iconBadgeCls}`}>
                  {variant === 'danger' ? (
                    <Trash2 className="w-5 h-5" />
                  ) : variant === 'warning' ? (
                    <AlertTriangle className="w-5 h-5" />
                  ) : (
                    <CheckCircle2 className="w-5 h-5" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <h3 id="confirm-dialog-title" className="text-base font-bold tracking-tight">
                    {confirmState.title}
                  </h3>
                  <p className={`text-xs sm:text-sm mt-1.5 leading-relaxed whitespace-pre-line ${modalMutedText}`}>
                    {confirmState.message}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => closeConfirm(false)}
                  className={`p-1 rounded-lg transition cursor-pointer ${
                    isLight ? 'text-slate-400 hover:text-slate-700 hover:bg-slate-100' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                  aria-label="Close confirmation dialog"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-5 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => closeConfirm(false)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${cancelBtnCls}`}
                >
                  {confirmState.cancelLabel || 'Cancel'}
                </button>
                <button
                  type="button"
                  autoFocus
                  onClick={() => closeConfirm(true)}
                  className={`px-4 py-2 rounded-xl text-xs font-bold transition cursor-pointer ${confirmBtnCls}`}
                >
                  {confirmState.confirmLabel || (variant === 'danger' ? 'Delete' : 'Confirm')}
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Prompt Input Dialog Portal */}
      {promptState &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fadeIn"
            onClick={() => closePrompt(null)}
            role="dialog"
            aria-modal="true"
            aria-labelledby="prompt-dialog-title"
          >
            <form
              onSubmit={(e) => {
                e.preventDefault();
                closePrompt(promptValue);
              }}
              onClick={(e) => e.stopPropagation()}
              className={`w-full max-w-md rounded-2xl border p-5 sm:p-6 transition-all ${modalSurface}`}
            >
              <div className="flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl border bg-amber-500/15 border-amber-500/30 text-amber-500 flex items-center justify-center shrink-0">
                  <MessageSquarePlus className="w-5 h-5" />
                </div>
                <div className="flex-1 min-w-0">
                  <h3 id="prompt-dialog-title" className="text-base font-bold tracking-tight">
                    {promptState.title}
                  </h3>
                  {promptState.message && (
                    <p className={`text-xs sm:text-sm mt-1 leading-relaxed ${modalMutedText}`}>
                      {promptState.message}
                    </p>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => closePrompt(null)}
                  className={`p-1 rounded-lg transition cursor-pointer ${
                    isLight ? 'text-slate-400 hover:text-slate-700 hover:bg-slate-100' : 'text-slate-400 hover:text-white hover:bg-slate-800'
                  }`}
                  aria-label="Close input dialog"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="mt-4">
                <input
                  ref={promptInputRef}
                  type="text"
                  value={promptValue}
                  onChange={(e) => setPromptValue(e.target.value)}
                  placeholder={promptState.placeholder || ''}
                  className={`w-full px-3.5 py-2.5 rounded-xl border text-sm focus:outline-none transition ${inputSurface}`}
                />
              </div>

              <div className="mt-5 flex items-center justify-end gap-2.5">
                <button
                  type="button"
                  onClick={() => closePrompt(null)}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition cursor-pointer ${cancelBtnCls}`}
                >
                  {promptState.cancelLabel || 'Cancel'}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-xl text-xs font-bold bg-amber-500 hover:bg-amber-400 text-slate-950 transition cursor-pointer shadow-sm"
                >
                  {promptState.confirmLabel || 'Save'}
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}

      {/* Non-blocking Floating Toast Stack */}
      {toasts.length > 0 &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed bottom-4 right-4 z-[130] flex flex-col gap-2 max-w-sm w-[calc(100vw-2rem)] pointer-events-none"
            aria-live="polite"
          >
            {toasts.map((item) => {
              const toastStyles =
                item.type === 'error'
                  ? isLight
                    ? 'bg-rose-50 border-rose-200 text-rose-900'
                    : 'bg-rose-950/95 border-rose-500/40 text-rose-100'
                  : item.type === 'warning'
                  ? isLight
                    ? 'bg-amber-50 border-amber-200 text-amber-900'
                    : 'bg-amber-950/95 border-amber-500/40 text-amber-100'
                  : item.type === 'success'
                  ? isLight
                    ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
                    : 'bg-emerald-950/95 border-emerald-500/40 text-emerald-100'
                  : isLight
                  ? 'bg-white border-slate-200 text-slate-900'
                  : isNight
                  ? 'bg-zinc-900/95 border-zinc-700 text-zinc-100'
                  : 'bg-slate-900/95 border-slate-700 text-slate-100';

              return (
                <div
                  key={item.id}
                  className={`pointer-events-auto flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl border shadow-xl backdrop-blur-md text-xs font-medium animate-fadeIn ${toastStyles}`}
                >
                  {item.type === 'error' ? (
                    <XCircle className="w-4 h-4 text-rose-500 shrink-0 mt-0.5" />
                  ) : item.type === 'warning' ? (
                    <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                  ) : item.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  ) : (
                    <Info className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
                  )}
                  <span className="flex-1 leading-snug">{item.message}</span>
                  <button
                    type="button"
                    onClick={() => setToasts((prev) => prev.filter((t) => t.id !== item.id))}
                    className="opacity-60 hover:opacity-100 transition cursor-pointer shrink-0"
                    aria-label="Dismiss notification"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              );
            })}
          </div>,
          document.body
        )}
    </ConfirmDialogContext.Provider>
  );
};

export function useConfirm(): ConfirmDialogContextValue {
  const ctx = useContext(ConfirmDialogContext);
  if (!ctx) {
    throw new Error('useConfirm must be used within a ConfirmDialogProvider');
  }
  return ctx;
}
