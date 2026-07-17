import React from "react";

type Props = {
  file: File | null;
  previewUrl: string | null;
  onPickFile: (file: File | null) => void;
};

const ACCEPTED_HINT =
  "Consigliati: JPG/JPEG, PNG, WEBP (formati tipici Instagram/Facebook/WhatsApp). " +
  "Se hai un file HEIC e non viene accettato, convertilo in JPG.";

export default function ReliefUpload({ file, previewUrl, onPickFile }: Props) {
  const inputRef = React.useRef<HTMLInputElement | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    onPickFile(f);
  }

  function clear() {
    // reset input value so the same file can be re-selected
    if (inputRef.current) inputRef.current.value = "";
    onPickFile(null);
  }

  return (
    <div className="rounded-lg bg-white p-6 shadow space-y-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">1) Carica un’immagine</h2>
          <p className="text-sm text-gray-600 mt-1">{ACCEPTED_HINT}</p>
        </div>

        {file ? (
          <button
            type="button"
            onClick={clear}
            className="text-sm px-3 py-2 rounded border hover:bg-gray-50"
            title="Rimuovi immagine"
          >
            Rimuovi
          </button>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 items-start">
        <div className="space-y-2">
          <label className="block text-sm font-medium">Seleziona file</label>
          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            onChange={handleChange}
            className="block w-full text-sm"
          />

          <div className="text-xs text-gray-500">
            Tip: immagini “scaricate dai social” sono quasi sempre già ok.
          </div>

          {file ? (
            <div className="text-sm text-gray-700">
              <div className="font-medium">File:</div>
              <div className="break-all">{file.name}</div>
              <div className="text-xs text-gray-500">
                {(file.size / (1024 * 1024)).toFixed(2)} MB
              </div>
            </div>
          ) : (
            <div className="text-sm text-gray-600">
              Nessun file selezionato.
            </div>
          )}
        </div>

        <div className="space-y-2">
          <div className="text-sm font-medium">Anteprima</div>
          <div className="aspect-video w-full rounded border bg-gray-50 overflow-hidden flex items-center justify-center">
            {previewUrl ? (
              <img
                src={previewUrl}
                alt="Anteprima immagine caricata"
                className="max-h-full max-w-full object-contain"
              />
            ) : (
              <div className="text-sm text-gray-500">
                Carica un’immagine per vedere l’anteprima.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
