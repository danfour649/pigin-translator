"use client";

import {
  emptyCorrection,
  getCatalogSnapshot,
  getServerCatalogSnapshot,
  removeCatalogItem,
  subscribeCatalog,
  updateCatalogCorrection,
  type Correction,
} from "@/lib/catalog";
import { useState, useSyncExternalStore } from "react";

export function SavedCatalog() {
  const items = useSyncExternalStore(
    subscribeCatalog,
    getCatalogSnapshot,
    getServerCatalogSnapshot,
  );
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Correction>(emptyCorrection());

  function openCorrection(id: string) {
    const item = items.find((entry) => entry.id === id);
    setEditingId(id);
    setDraft(item?.correction ?? emptyCorrection());
  }

  function saveCorrection(id: string) {
    updateCatalogCorrection(id, {
      english: draft.english.trim(),
      naija: draft.naija.trim(),
      yoruba: draft.yoruba.trim(),
      note: draft.note.trim(),
    });
    setEditingId(null);
  }

  return (
    <section className="rounded-3xl border border-line bg-card p-4 sm:p-6" aria-labelledby="saved-translations">
      <h2 id="saved-translations" className="font-display text-3xl text-ink">
        Saved translations
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Bookmarks and corrections stay in this browser. They are not sent to
        the translation model.
      </p>
      {items.length === 0 ? (
        <p className="mt-4 text-sm text-muted">
          No saved translations yet. Bookmark a result to keep it here.
        </p>
      ) : (
        <ul className="mt-4 flex flex-col gap-4">
          {items.map((item) => {
            const editing = editingId === item.id;
            return (
              <li
                key={item.id}
                className="rounded-2xl border border-line bg-white p-4"
              >
                <p className="text-sm font-semibold text-ink">{item.modelLabel}</p>
                <p className="mt-2 text-sm text-muted">English</p>
                <p className="whitespace-pre-wrap">{item.english}</p>
                <p className="mt-2 text-sm text-muted">Naijá</p>
                <p lang="pcm" className="whitespace-pre-wrap">
                  {item.naija || "No Naijá text was saved."}
                </p>
                <p className="mt-2 text-sm text-muted">Yorùbá</p>
                <p lang="yo" className="whitespace-pre-wrap">
                  {item.yoruba || "No Yorùbá text was saved."}
                </p>
                {item.correction ? (
                  <div className="mt-3 rounded-xl bg-paper px-3 py-2 text-sm">
                    <p className="font-semibold">Correction</p>
                    {item.correction.english ? (
                      <p className="mt-1">English: {item.correction.english}</p>
                    ) : null}
                    {item.correction.naija ? (
                      <p className="mt-1" lang="pcm">
                        Naijá: {item.correction.naija}
                      </p>
                    ) : null}
                    {item.correction.yoruba ? (
                      <p className="mt-1" lang="yo">
                        Yorùbá: {item.correction.yoruba}
                      </p>
                    ) : null}
                    {item.correction.note ? (
                      <p className="mt-1">Note: {item.correction.note}</p>
                    ) : null}
                  </div>
                ) : null}
                {editing ? (
                  <form
                    className="mt-3 flex flex-col gap-3"
                    onSubmit={(event) => {
                      event.preventDefault();
                      saveCorrection(item.id);
                    }}
                  >
                    <CorrectionField
                      id={`${item.id}-english`}
                      label="Corrected English"
                      value={draft.english}
                      onChange={(english) =>
                        setDraft((current) => ({ ...current, english }))
                      }
                    />
                    <CorrectionField
                      id={`${item.id}-naija`}
                      label="Corrected Naijá"
                      value={draft.naija}
                      onChange={(naija) =>
                        setDraft((current) => ({ ...current, naija }))
                      }
                    />
                    <CorrectionField
                      id={`${item.id}-yoruba`}
                      label="Corrected Yorùbá"
                      value={draft.yoruba}
                      onChange={(yoruba) =>
                        setDraft((current) => ({ ...current, yoruba }))
                      }
                    />
                    <CorrectionField
                      id={`${item.id}-note`}
                      label="What was wrong"
                      value={draft.note}
                      onChange={(note) =>
                        setDraft((current) => ({ ...current, note }))
                      }
                    />
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="submit"
                        className="rounded-full bg-green-ink px-4 py-2 text-sm font-semibold text-card hover:bg-green focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                      >
                        Save correction
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditingId(null)}
                        className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                ) : (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => openCorrection(item.id)}
                      className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                    >
                      {item.correction ? "Edit correction" : "Add a correction"}
                    </button>
                    <button
                      type="button"
                      onClick={() => removeCatalogItem(item.id)}
                      className="rounded-full border border-line px-4 py-2 text-sm font-semibold hover:bg-paper focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green"
                    >
                      Remove
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CorrectionField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="block text-sm">
      <span className="font-semibold">{label}</span>
      <textarea
        id={id}
        value={value}
        rows={2}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 w-full resize-y rounded-xl border border-line bg-white px-3 py-2 text-base text-ink outline-none focus-visible:border-green focus-visible:ring-2 focus-visible:ring-green/30"
      />
    </label>
  );
}
