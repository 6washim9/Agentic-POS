import { MicIcon } from "./Icons";

type MicButtonProps = {
  listening: boolean;
  label: string;
  onClick: () => void;
};

export function MicButton({ listening, label, onClick }: MicButtonProps) {
  return (
    <div className="mic-wrap">
      <button
        type="button"
        className={`mic-btn${listening ? " listening" : ""}`}
        aria-label={label}
        aria-pressed={listening}
        onClick={onClick}
      >
        <MicIcon />
      </button>
    </div>
  );
}
