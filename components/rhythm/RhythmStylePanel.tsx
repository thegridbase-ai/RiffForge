import React, { useId } from 'react';
import type { PickingMode, RhythmGrid, RhythmStyleId } from '../../engine/types';
import { RHYTHM_STYLES, RHYTHM_STYLE_IDS } from '../../engine/rhythm/styles';
import { RHYTHM_BAR_OPTIONS, useRhythmStore } from '../../stores/rhythmStore';
import { SECTION_LABEL, SEGMENT_GROUP, segmentClass, type RhythmTheme } from './theme';

interface RhythmStylePanelProps {
  theme: RhythmTheme;
  onAnnounce: (message: string) => void;
}

interface SegmentOption<T> {
  value: T;
  label: string;
  aria: string;
}

const GRID_OPTIONS: SegmentOption<RhythmGrid>[] = [
  { value: '16th', label: '16th', aria: 'Sixteenth-note grid' },
  { value: '16th-triplet', label: '16th trip', aria: 'Sixteenth-triplet grid' }
];

const PICKING_OPTIONS: SegmentOption<PickingMode>[] = [
  { value: 'alternate', label: 'Alternate', aria: 'Alternate picking' },
  { value: 'downstrokes', label: 'Downs', aria: 'All downstrokes' }
];

const Segmented = <T extends string | number>({
  label,
  options,
  value,
  onChange,
  theme
}: {
  label: string;
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  theme: RhythmTheme;
}): React.ReactElement => (
  <div role="group" aria-label={label}>
    <span className={`${SECTION_LABEL} block mb-1.5 px-1`} aria-hidden="true">
      {label}
    </span>
    <div className={SEGMENT_GROUP} style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={String(option.value)}
            type="button"
            aria-pressed={active}
            aria-label={option.aria}
            onClick={() => onChange(option.value)}
            className={segmentClass(theme, active)}
          >
            {option.label}
            {active && <span aria-hidden="true" className={`absolute bottom-0 w-1/3 h-0.5 ${theme.underline}`} />}
          </button>
        );
      })}
    </div>
  </div>
);

const Slider: React.FC<{
  label: string;
  value: number;
  onChange: (value: number) => void;
  theme: RhythmTheme;
  hint: string;
}> = ({ label, value, onChange, theme, hint }) => {
  const id = useId();
  const percent = Math.round(value * 100);
  return (
    <div>
      <label htmlFor={id} className={`${SECTION_LABEL} flex items-center justify-between mb-1 px-1`}>
        <span>{label}</span>
        <span className={`font-['Share_Tech_Mono'] text-xs tracking-normal ${theme.text}`}>{percent}%</span>
      </label>
      <input
        id={id}
        type="range"
        min={0}
        max={100}
        step={5}
        value={percent}
        aria-valuetext={`${percent} percent, ${hint}`}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className={`w-full h-11 md:h-6 cursor-pointer bg-transparent ${theme.rangeAccent} ${theme.ring}`}
      />
    </div>
  );
};

/** Style presets, density / syncopation sliders, grid, bars and picking. */
export const RhythmStylePanel: React.FC<RhythmStylePanelProps> = ({ theme, onAnnounce }) => {
  const params = useRhythmStore((s) => s.params);
  const setStyle = useRhythmStore((s) => s.setStyle);
  const setParam = useRhythmStore((s) => s.setParam);
  const style = RHYTHM_STYLES[params.style];

  const chooseStyle = (id: RhythmStyleId) => {
    setStyle(id);
    onAnnounce(`${RHYTHM_STYLES[id].label}: ${RHYTHM_STYLES[id].description}`);
  };

  return (
    <div className="space-y-4">
      <div role="group" aria-labelledby="rhythm-style-label">
        <span id="rhythm-style-label" className={`${SECTION_LABEL} block mb-1.5 px-1`}>
          Style preset
        </span>
        <div className={`${SEGMENT_GROUP} grid-cols-2 sm:grid-cols-3`}>
          {RHYTHM_STYLE_IDS.map((id) => {
            const active = id === params.style;
            return (
              <button
                key={id}
                type="button"
                aria-pressed={active}
                title={RHYTHM_STYLES[id].description}
                onClick={() => chooseStyle(id)}
                className={segmentClass(theme, active)}
              >
                {RHYTHM_STYLES[id].label}
                {active && <span aria-hidden="true" className={`absolute bottom-0 w-1/3 h-0.5 ${theme.underline}`} />}
              </button>
            );
          })}
        </div>
        <p className="mt-2 px-1 text-sm text-neutral-400 font-light leading-snug">{style.description}</p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
        <Slider
          label="Density"
          value={params.density}
          onChange={(density) => setParam({ density })}
          theme={theme}
          hint="how many grid cells get a hit"
        />
        <Slider
          label="Syncopation"
          value={params.syncopation}
          onChange={(syncopation) => setParam({ syncopation })}
          theme={theme}
          hint="offbeat accents and pushes"
        />
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Segmented
          label="Grid"
          options={GRID_OPTIONS}
          value={params.grid}
          onChange={(grid) => setParam({ grid })}
          theme={theme}
        />
        <Segmented
          label="Bars"
          options={RHYTHM_BAR_OPTIONS.map((bars) => ({ value: bars, label: String(bars), aria: `${bars} bar${bars === 1 ? '' : 's'}` }))}
          value={params.bars}
          onChange={(bars) => setParam({ bars })}
          theme={theme}
        />
        <Segmented
          label="Picking"
          options={PICKING_OPTIONS}
          value={params.picking}
          onChange={(picking) => setParam({ picking })}
          theme={theme}
        />
      </div>
    </div>
  );
};
