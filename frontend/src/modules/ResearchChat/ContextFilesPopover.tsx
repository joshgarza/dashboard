import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import type { ResearchFileInfo } from './types.ts';

interface ContextFilesPopoverProps {
  files: ResearchFileInfo[];
  selectedFiles: string[];
  onSelectFiles: (files: string[]) => void;
  filesLoading: boolean;
}

export function ContextFilesPopover({
  files,
  selectedFiles,
  onSelectFiles,
  filesLoading,
}: ContextFilesPopoverProps) {
  const [open, setOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleClick(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const researchFiles = files.filter(f => f.type === 'research');
  const principleFiles = files.filter(f => f.type === 'principles');
  const atMax = selectedFiles.length >= 3;

  function toggleFile(key: string) {
    if (selectedFiles.includes(key)) {
      onSelectFiles(selectedFiles.filter(k => k !== key));
    } else if (!atMax) {
      onSelectFiles([...selectedFiles, key]);
    }
  }

  return (
    <div className="relative" ref={popoverRef}>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={() => setOpen(o => !o)}
        className="h-8 w-8 cursor-pointer rounded-lg p-0 transition-colors hover:bg-muted"
        disabled={filesLoading}
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48" />
        </svg>
      </Button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-72 rounded-lg border bg-popover text-popover-foreground shadow-md z-50">
          <div className="p-3 space-y-3 max-h-64 overflow-y-auto">
            <div className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Context files (max 3)
            </div>

            {researchFiles.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-muted-foreground">Research</div>
                {researchFiles.map(f => {
                  const checked = selectedFiles.includes(f.key);
                  const disabled = atMax && !checked;
                  return (
                    <label
                      key={f.key}
                      className={`flex items-center gap-2 rounded px-2 py-1 text-sm cursor-pointer hover:bg-muted/50 ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleFile(f.key)}
                        className="rounded border-input"
                      />
                      <span className="truncate flex-1">{f.topic}</span>
                      {f.date && (
                        <span className="text-xs text-muted-foreground shrink-0">{f.date}</span>
                      )}
                    </label>
                  );
                })}
              </div>
            )}

            {principleFiles.length > 0 && (
              <div className="space-y-1">
                <div className="text-xs font-semibold text-muted-foreground">Principles</div>
                {principleFiles.map(f => {
                  const checked = selectedFiles.includes(f.key);
                  const disabled = atMax && !checked;
                  return (
                    <label
                      key={f.key}
                      className={`flex items-center gap-2 rounded px-2 py-1 text-sm cursor-pointer hover:bg-muted/50 ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={disabled}
                        onChange={() => toggleFile(f.key)}
                        className="rounded border-input"
                      />
                      <span className="truncate flex-1">{f.topic}</span>
                    </label>
                  );
                })}
              </div>
            )}

            {files.length === 0 && !filesLoading && (
              <div className="text-sm text-muted-foreground">No files available</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
