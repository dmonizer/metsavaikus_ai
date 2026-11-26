import React, { useEffect, useState } from 'react';
import { X, Volume2, VolumeX, Play, Pause, Square, RefreshCw, Zap, RotateCcw } from 'lucide-react';
import type { DiagnosticsSnapshot, ValidationIssue } from '../soundscape/types';
import { formatGameHour } from '../game/survivalEngine';

export interface SoundscapeDiagnosticsOverlayProps {
  open: boolean;
  snapshot: DiagnosticsSnapshot | null;
  availableSoundIds: string[];
  onClose: () => void;
  onTriggerEvent: (type: string, intensity?: number) => void;
  onAuditionSound: (soundId: string) => boolean;
  onStopAudition: () => number;
  onPauseVoice?: (instanceId: string) => boolean;
  onResumeVoice?: (instanceId: string) => boolean;
  onStopVoice?: (instanceId: string) => boolean;
  onClearQuotas: () => void;
  onSetBusVolume: (busId: string, volume: number) => void;
  onSetBusMuted: (busId: string, muted: boolean) => void;
  onSetMusicEnabled: (enabled: boolean) => void;
  onSetMusicVolume: (volume: number) => void;
  onGetConfigJson: () => string;
  onReloadConfigJson: (json: string) => {
    ok: boolean;
    issues: ValidationIssue[];
    diffSummary?: string;
  };
}

type DiagTab = 'voices' | 'rules' | 'acoustics' | 'mixer' | 'config';

const TEST_EVENT_OPTIONS = [
  'player.weapon.fire',
  'weather.thunder',
  'player.kick',
  'object.break',
  'object.impact',
  'object.door.open',
  'object.door.close',
  'player.land',
];

export const SoundscapeDiagnosticsOverlay: React.FC<SoundscapeDiagnosticsOverlayProps> = ({
  open,
  snapshot,
  availableSoundIds,
  onClose,
  onTriggerEvent,
  onAuditionSound,
  onStopAudition,
  onPauseVoice,
  onResumeVoice,
  onStopVoice,
  onClearQuotas,
  onSetBusVolume,
  onSetBusMuted,
  onSetMusicEnabled,
  onSetMusicVolume,
  onGetConfigJson,
  onReloadConfigJson,
}) => {
  const [tab, setTab] = useState<DiagTab>('voices');
  const [ruleFilter, setRuleFilter] = useState('');
  const [selectedSoundId, setSelectedSoundId] = useState<string>(
    availableSoundIds[0] ?? 'forest_wind_loop'
  );
  const [auditionFeedback, setAuditionFeedback] = useState<string | null>(null);
  const [quotaFeedback, setQuotaFeedback] = useState<string | null>(null);
  const [configText, setConfigText] = useState<string>('');
  const [reloadStatus, setReloadStatus] = useState<{
    ok: boolean;
    message: string;
    issues: ValidationIssue[];
  } | null>(null);

  useEffect(() => {
    if (open && tab === 'config' && !configText) {
      setConfigText(onGetConfigJson());
    }
  }, [open, tab, configText, onGetConfigJson]);

  if (!open) return null;

  const filteredRules = (snapshot?.rules ?? []).filter((r) => {
    if (!ruleFilter.trim()) return true;
    const q = ruleFilter.trim().toLowerCase();
    return (
      r.soundId.toLowerCase().includes(q) ||
      r.bus.toLowerCase().includes(q) ||
      r.reasons.some((rs) => rs.toLowerCase().includes(q))
    );
  });

  const handleLoadCurrentJson = () => {
    setConfigText(onGetConfigJson());
    setReloadStatus(null);
  };

  const handleApplyReload = () => {
    const res = onReloadConfigJson(configText);
    if (res.ok) {
      setReloadStatus({
        ok: true,
        message: res.diffSummary ?? 'Config hot-reloaded successfully.',
        issues: res.issues,
      });
    } else {
      setReloadStatus({
        ok: false,
        message: 'Validation failed — previous valid configuration preserved.',
        issues: res.issues,
      });
    }
  };

  const activeAuditionVoices = (snapshot?.voices ?? []).filter(
    (v) => v.isAudition && v.state !== 'completed'
  );

  const handleAudition = () => {
    onStopAudition();
    const ok = onAuditionSound(selectedSoundId);
    setAuditionFeedback(
      ok
        ? `Auditioning "${selectedSoundId}"`
        : `Unable to audition "${selectedSoundId}"`
    );
  };

  const handleStopAudition = () => {
    const count = onStopAudition();
    setAuditionFeedback(
      count > 0 ? 'Audition stopped' : 'No active audition voice'
    );
  };

  const handleClearQuotas = () => {
    onClearQuotas();
    setQuotaFeedback('Saved quotas & cooldowns cleared');
    window.setTimeout(() => setQuotaFeedback(null), 2500);
  };

  return (
    <aside
      data-testid="soundscape-diagnostics"
      aria-label="Soundscape Diagnostics"
      className="fixed top-4 right-4 z-40 w-[610px] max-w-[94vw] h-[calc(100vh-2rem)] flex flex-col rounded-lg bg-[#0b110d]/95 border border-white/15 text-[#e6efe4] shadow-[0_20px_50px_rgba(0,0,0,0.75)] pointer-events-auto select-text"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-white/12">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-[0.16em] text-[#9ec4a0]">
              Soundscape Diagnostics
            </span>
            <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[#18241d] border border-white/12 text-[#bfd2bd]">
              F9
            </span>
          </div>
          {snapshot && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono tabular-nums text-[11px] text-[#9eb29d]">
              <span>Time {formatGameHour(snapshot.timeOfDayHours)}</span>
              <span>×{snapshot.timeAcceleration.toFixed(1)}</span>
              <span>{snapshot.backendKind}</span>
              <span>
                Voices {snapshot.activeCount} active / {snapshot.virtualCount} virtual /{' '}
                {snapshot.queuedCount} queued
              </span>
            </div>
          )}
        </div>
        <button
          type="button"
          data-testid="diag-close-btn"
          onClick={onClose}
          aria-label="Close Soundscape Diagnostics"
          className="w-8 h-8 flex items-center justify-center rounded bg-[#16211a] hover:bg-[#223227] border border-white/12 text-[#cfe0cd] cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Tab Bar */}
      <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-white/10 bg-[#0e1611]">
        {(
          [
            ['voices', 'Voices'],
            ['rules', 'Scheduler & Rules'],
            ['acoustics', 'Acoustics & Disturbances'],
            ['mixer', 'Mixer & Audition'],
            ['config', 'Config Reload'],
          ] as Array<[DiagTab, string]>
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            data-testid={`diag-tab-${id}`}
            onClick={() => setTab(id)}
            className={`px-2 py-1 rounded text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
              tab === id
                ? 'bg-[#2c4733] text-[#f2f8f1] border border-[#6e997a]'
                : 'bg-[#131d17] text-[#a7bba6] border border-white/10 hover:bg-[#1b2920] hover:text-white'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3.5 space-y-3 text-xs">
        {!snapshot && (
          <div className="p-4 rounded bg-[#121b15] border border-white/10 text-[#9db19c]">
            Waiting for simulation audio tick...
          </div>
        )}

        {snapshot && tab === 'voices' && (
          <>
            {/* Biome mix + Music summary */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="rounded bg-[#111914] border border-white/10 p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-[#95ab94] mb-1.5">
                  Biome Mix
                </div>
                <div className="space-y-1 font-mono text-[11px]">
                  {snapshot.biomeMix.length === 0 ? (
                    <div className="text-[#7c907b]">No biome composition</div>
                  ) : (
                    snapshot.biomeMix.map((b) => (
                      <div key={b.biome} className="flex items-center justify-between gap-2">
                        <span className="text-[#d4e2d2]">{b.biome}</span>
                        <div className="flex-1 h-1.5 bg-black/50 rounded overflow-hidden">
                          <div
                            className="h-full bg-[#77ab7d]"
                            style={{ width: `${Math.round(b.weight * 100)}%` }}
                          />
                        </div>
                        <span className="tabular-nums text-[#a6baa5]">
                          {Math.round(b.weight * 100)}%
                        </span>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded bg-[#111914] border border-white/10 p-2.5">
                <div className="text-[10px] uppercase tracking-wider text-[#95ab94] mb-1.5">
                  Adaptive Music
                </div>
                <div className="space-y-0.5 font-mono text-[11px]">
                  <div className="flex justify-between">
                    <span className="text-[#9cb19b]">Profile</span>
                    <span className="text-[#e6efe4]">
                      {snapshot.music.activeProfileId ?? 'none'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#9cb19b]">Track</span>
                    <span className="text-[#d6e4d4] truncate max-w-[160px]">
                      {snapshot.music.activeTrackId ?? '—'}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-[#9cb19b]">State / Gain</span>
                    <span className="text-[#bcd6bc] tabular-nums">
                      {snapshot.music.state} · {Math.round(snapshot.music.volume * 100)}%
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Active, paused, virtualised & recently stopped voices table */}
            <div className="rounded bg-[#111914] border border-white/10 overflow-hidden">
              <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between gap-2">
                <span className="text-[10px] uppercase tracking-wider text-[#95ab94]">
                  Voices ({snapshot.voices.length}
                  {(snapshot.stoppedVoices?.length ?? 0) > 0
                    ? ` + ${snapshot.stoppedVoices!.length} stopped`
                    : ''}
                  )
                </span>
                <span className="font-mono text-[10px] text-[#9eb29d]">
                  Loaded {snapshot.assetStatus.loaded}
                  {snapshot.assetStatus.pending > 0 ? ` · Pending ${snapshot.assetStatus.pending}` : ''}
                  {' · '}Procedural {snapshot.assetStatus.procedural}
                  {snapshot.assetStatus.failed.length > 0 ? ` · Failed ${snapshot.assetStatus.failed.length}` : ''}
                </span>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full table-fixed text-left border-collapse font-mono text-[10.5px]">
                  <thead>
                    <tr className="border-b border-white/10 text-[#8fa58e] bg-[#0e1510]">
                      <th className="py-1.5 px-1.5 w-[29%]">Sound</th>
                      <th className="py-1.5 px-1.5 w-[22%]">Bus</th>
                      <th className="py-1.5 px-1.5 w-[13%]">State</th>
                      <th className="py-1.5 px-1.5 w-[8%] text-right">Dist</th>
                      <th className="py-1.5 px-1.5 w-[7%] text-right">Gain</th>
                      <th className="py-1.5 px-1.5 w-[9%] text-right">LPF</th>
                      <th className="py-1.5 px-1.5 w-[12%] text-right">Ctrl</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snapshot.voices.length === 0 && (snapshot.stoppedVoices?.length ?? 0) === 0 ? (
                      <tr>
                        <td colSpan={7} className="py-3 px-2 text-center text-[#7c907b]">
                          No active sound instances
                        </td>
                      </tr>
                    ) : (
                      [...snapshot.voices, ...(snapshot.stoppedVoices ?? [])].map((v) => {
                        const isStopped = v.state === 'stopped';
                        const isPaused = v.state === 'paused';
                        const canPauseOrResume =
                          !isStopped &&
                          (v.state === 'playing' || v.state === 'starting' || v.state === 'stopping' || isPaused);
                        const stoppedRemainSec =
                          isStopped && v.stoppedAtRealMs !== undefined
                            ? Math.max(0, 5 - (snapshot.realTimeMs - v.stoppedAtRealMs) / 1000)
                            : 0;
                        return (
                          <tr
                            key={`${v.instanceId}-${isStopped ? 'stopped' : 'live'}`}
                            data-testid={`voice-row-${v.instanceId}`}
                            data-voice-state={v.state}
                            className={`border-b border-white/5 ${
                              isStopped ? 'bg-[#2a1212]/55' : 'hover:bg-white/3'
                            }`}
                          >
                            <td className="py-1.5 px-1.5 truncate">
                              <div
                                className={`truncate ${isStopped ? 'text-[#f29b9b]' : 'text-[#e7f0e5]'}`}
                                title={v.soundId}
                              >
                                {v.soundId}
                              </div>
                              <div className="text-[9.5px] text-[#839782] truncate" title={v.reason}>
                                {v.reason}
                              </div>
                            </td>
                            <td className="py-1.5 px-1.5 text-[#a8bca7] truncate" title={v.bus}>
                              {v.bus}
                            </td>
                            <td className="py-1.5 px-1.5 truncate">
                              <span
                                className={
                                  isStopped
                                    ? 'text-[#f26b6b] font-semibold'
                                    : v.state === 'virtualised'
                                      ? 'text-[#dfb86c]'
                                      : isPaused
                                        ? 'text-[#e3b568] font-medium'
                                        : v.state === 'playing'
                                          ? 'text-[#89cb91]'
                                          : 'text-[#a5b9a4]'
                                }
                              >
                                {v.state}
                              </span>
                            </td>
                            <td className="py-1.5 px-1.5 text-right tabular-nums text-[#bfd2bd]">
                              {v.distanceM !== null ? `${v.distanceM.toFixed(1)}m` : '2D'}
                            </td>
                            <td className="py-1.5 px-1.5 text-right tabular-nums text-[#d6e4d4]">
                              {v.effectiveGain.toFixed(2)}
                            </td>
                            <td className="py-1.5 px-1.5 text-right tabular-nums text-[#a6baa5]">
                              {Math.round(v.lowpassHz)}Hz
                            </td>
                            <td className="py-1.5 px-1.5 text-right">
                              {isStopped ? (
                                <span
                                  data-testid={`voice-stopped-ttl-${v.instanceId}`}
                                  className="tabular-nums text-[10px] text-[#f27b7b]"
                                >
                                  {stoppedRemainSec.toFixed(1)}s
                                </span>
                              ) : (
                                <div className="inline-flex items-center justify-end gap-1">
                                  {canPauseOrResume && (
                                    <button
                                      type="button"
                                      data-testid={`voice-pause-btn-${v.instanceId}`}
                                      onClick={() =>
                                        isPaused
                                          ? onResumeVoice?.(v.instanceId)
                                          : onPauseVoice?.(v.instanceId)
                                      }
                                      aria-label={isPaused ? `Resume ${v.soundId}` : `Pause ${v.soundId}`}
                                      title={isPaused ? 'Resume voice' : 'Pause voice'}
                                      className={`w-5 h-5 inline-flex items-center justify-center rounded border cursor-pointer ${
                                        isPaused
                                          ? 'bg-[#2a4530] border-[#6d9a77]/65 text-[#eaf5eb] hover:bg-[#36593e]'
                                          : 'bg-[#17231c] border-white/15 text-[#cfe0cd] hover:bg-[#24342a]'
                                      }`}
                                    >
                                      {isPaused ? (
                                        <Play className="w-2.5 h-2.5" />
                                      ) : (
                                        <Pause className="w-2.5 h-2.5" />
                                      )}
                                    </button>
                                  )}
                                  <button
                                    type="button"
                                    data-testid={`voice-stop-btn-${v.instanceId}`}
                                    onClick={() => onStopVoice?.(v.instanceId)}
                                    aria-label={`Stop ${v.soundId}`}
                                    title="Stop voice"
                                    className="w-5 h-5 inline-flex items-center justify-center rounded bg-[#2c1918] hover:bg-[#442422] border border-[#8e534d]/50 text-[#f0b4ae] cursor-pointer"
                                  >
                                    <Square className="w-2.5 h-2.5" />
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}

        {snapshot && tab === 'rules' && (
          <>
            <div className="flex items-center gap-2">
              <input
                type="text"
                data-testid="diag-rule-filter"
                value={ruleFilter}
                onChange={(e) => setRuleFilter(e.target.value)}
                placeholder="Filter rules by soundId, bus, or block reason..."
                className="flex-1 px-2.5 py-1.5 rounded bg-[#0f1712] border border-white/15 text-xs text-[#e6efe4] placeholder-[#6e826d] focus:outline-none focus:border-[#78a180]"
              />
              <span className="font-mono text-[11px] text-[#9eb29d] tabular-nums">
                {filteredRules.length} rules
              </span>
              <button
                type="button"
                data-testid="diag-clear-quotas-btn"
                onClick={handleClearQuotas}
                className="px-2.5 py-1.5 rounded bg-[#2a1f1a] hover:bg-[#3b2b23] border border-[#9e7762]/50 text-[11px] font-medium text-[#f2dfd3] flex items-center gap-1 cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3 h-3" />
                Clear Quotas
              </button>
            </div>
            {quotaFeedback && (
              <div
                data-testid="diag-clear-quotas-status"
                className="font-mono text-[11px] text-[#a7d4aa]"
              >
                {quotaFeedback}
              </div>
            )}

            <div className="rounded bg-[#111914] border border-white/10 overflow-hidden">
              <table className="w-full text-left border-collapse font-mono text-[11px]">
                <thead>
                  <tr className="border-b border-white/10 text-[#8fa58e] bg-[#0e1510]">
                    <th className="py-1.5 px-2">Sound / Type</th>
                    <th className="py-1.5 px-2">Quota</th>
                    <th className="py-1.5 px-2">Status & Reasons</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRules.map((r) => (
                    <tr key={r.soundId} className="border-b border-white/5 align-top">
                      <td className="py-1.5 px-2">
                        <div className="text-[#e7f0e5]">{r.soundId}</div>
                        <div className="text-[10px] text-[#839782]">
                          {r.triggerType} · {r.bus}
                        </div>
                      </td>
                      <td className="py-1.5 px-2 tabular-nums text-[#bfd2bd]">
                        {r.quotaUsed}
                        {r.quotaTarget !== null ? `/${r.quotaTarget}` : ''}
                        {r.quotaMax !== null ? ` (max ${r.quotaMax})` : ''}
                        {r.cooldownRemainingSimSec > 0 && (
                          <div className="text-[10px] text-[#dfb86c]">
                            cd {r.cooldownRemainingSimSec.toFixed(0)}s
                          </div>
                        )}
                        {r.nextScheduledSimSec !== null && r.eligible && (
                          <div className="text-[10px] text-[#8dc2a8]">
                            next {Math.round(r.nextScheduledSimSec)}s sim
                          </div>
                        )}
                      </td>
                      <td className="py-1.5 px-2">
                        <span
                          className={
                            r.eligible ? 'text-[#89cb91] font-semibold' : 'text-[#e38c7c]'
                          }
                        >
                          {r.eligible ? 'eligible' : 'blocked'}
                        </span>
                        {r.reasons.length > 0 && (
                          <div className="text-[10px] text-[#9eb29d] mt-0.5">
                            {r.reasons.join('; ')}
                          </div>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {snapshot && tab === 'acoustics' && (
          <>
            <div className="rounded bg-[#111914] border border-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wider text-[#95ab94] mb-2">
                Environmental Acoustics
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 font-mono text-[11px]">
                <div>
                  <div className="text-[#839782]">Profile</div>
                  <div className="text-[#e6efe4]">{snapshot.acoustics.profileId}</div>
                </div>
                <div>
                  <div className="text-[#839782]">Enclosure / Roof</div>
                  <div className="text-[#e6efe4] tabular-nums">
                    {snapshot.acoustics.enclosure.toFixed(2)} /{' '}
                    {snapshot.acoustics.roofCoverage.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[#839782]">Portal Openness</div>
                  <div className="text-[#e6efe4] tabular-nums">
                    {snapshot.acoustics.portalOpenness.toFixed(2)}
                  </div>
                </div>
                <div>
                  <div className="text-[#839782]">Exterior Gain / LPF</div>
                  <div className="text-[#e6efe4] tabular-nums">
                    {snapshot.acoustics.exteriorGain.toFixed(2)} ·{' '}
                    {Math.round(snapshot.acoustics.exteriorLowpassHz)}Hz
                  </div>
                </div>
              </div>
              {snapshot.unsupportedBackendFeatures.length > 0 && (
                <div className="mt-2 pt-2 border-t border-white/10 text-[11px] text-[#dfb86c]">
                  Unsupported backend features:{' '}
                  {snapshot.unsupportedBackendFeatures.join(', ')}
                </div>
              )}
            </div>

            <div className="rounded bg-[#111914] border border-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wider text-[#95ab94] mb-2">
                Active Disturbances ({snapshot.disturbances.length})
              </div>
              {snapshot.disturbances.length === 0 ? (
                <div className="text-[#7c907b] font-mono text-[11px]">
                  No active disturbance suppressions
                </div>
              ) : (
                <div className="space-y-2 font-mono text-[11px]">
                  {snapshot.disturbances.map((d) => (
                    <div
                      key={d.instanceId}
                      className="p-2 rounded bg-[#0c130f] border border-white/8"
                    >
                      <div className="flex justify-between text-[#f0d090]">
                        <span>{d.profileId}</span>
                        <span className="tabular-nums">
                          {d.distanceFromListenerM.toFixed(1)}m / {d.radiusM}m (att{' '}
                          {d.attenuationAtListener.toFixed(2)})
                        </span>
                      </div>
                      <div className="mt-1 space-y-0.5 text-[10px] text-[#a6baa5]">
                        {d.effects.map((ef) => (
                          <div key={ef.target} className="flex justify-between">
                            <span>{ef.target}</span>
                            <span className="tabular-nums">
                              gain×{ef.currentGainMult.toFixed(2)} ·{' '}
                              {ef.blockingNewEvents ? 'blocking' : 'recovering'} · delay{' '}
                              {ef.remainingRecoveryDelaySimSec.toFixed(1)}s / fade{' '}
                              {ef.remainingRecoveryFadeSimSec.toFixed(1)}s
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded bg-[#111914] border border-white/10 p-3">
              <div className="text-[10px] uppercase tracking-wider text-[#95ab94] mb-2">
                Recent Event Trace ({snapshot.recentEvents.length})
              </div>
              <div className="space-y-1 font-mono text-[10.5px]">
                {snapshot.recentEvents.length === 0 ? (
                  <div className="text-[#7c907b]">No events dispatched yet</div>
                ) : (
                  [...snapshot.recentEvents].reverse().map((ev) => (
                    <div
                      key={ev.id}
                      className="flex items-center justify-between gap-2 py-0.5 border-b border-white/5"
                    >
                      <span className="text-[#d9e7d7]">{ev.type}</span>
                      <span className="text-[#8ca18b]">
                        {ev.origin} · d{ev.chainDepth}
                        {ev.correlationId ? ` · ${ev.correlationId.slice(0, 14)}` : ''}
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}

        {snapshot && tab === 'mixer' && (
          <>
            {/* Sound Audition & Event Triggers */}
            <div className="rounded bg-[#111914] border border-white/10 p-3 space-y-2.5">
              <div className="text-[10px] uppercase tracking-wider text-[#95ab94]">
                Sound Audition & Test Events
              </div>
              <div className="flex items-center gap-2">
                <select
                  data-testid="diag-audition-select"
                  value={selectedSoundId}
                  onChange={(e) => setSelectedSoundId(e.target.value)}
                  className="flex-1 px-2.5 py-1.5 rounded bg-[#0f1712] border border-white/15 font-mono text-[11px] text-[#e6efe4]"
                >
                  {availableSoundIds.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  data-testid="diag-audition-btn"
                  onClick={handleAudition}
                  className="px-3 py-1.5 rounded bg-[#2d4a34] hover:bg-[#3a6043] border border-[#729e7a]/60 text-xs font-medium text-[#eef5ec] flex items-center gap-1.5 cursor-pointer"
                >
                  <Play className="w-3.5 h-3.5" />
                  Audition
                </button>
                <button
                  type="button"
                  data-testid="diag-audition-stop-btn"
                  onClick={handleStopAudition}
                  className={`px-3 py-1.5 rounded border text-xs font-medium flex items-center gap-1.5 cursor-pointer ${
                    activeAuditionVoices.length > 0
                      ? 'bg-[#4d2624] hover:bg-[#66312e] border-[#c26e68]/70 text-[#fdeeed]'
                      : 'bg-[#1b241f] hover:bg-[#243129] border-white/15 text-[#9fb29e]'
                  }`}
                >
                  <Square className="w-3 h-3" />
                  Stop
                </button>
              </div>
              {(activeAuditionVoices.length > 0 || auditionFeedback) && (
                <div
                  data-testid="diag-audition-status"
                  className="font-mono text-[11px] text-[#a7d4aa]"
                >
                  {activeAuditionVoices.length > 0
                    ? `Playing preview: ${activeAuditionVoices.map((v) => v.soundId).join(', ')}`
                    : auditionFeedback}
                </div>
              )}

              <div className="pt-1 flex flex-wrap gap-1.5">
                {TEST_EVENT_OPTIONS.map((evtType) => (
                  <button
                    key={evtType}
                    type="button"
                    data-testid={`diag-event-${evtType}`}
                    onClick={() => onTriggerEvent(evtType, 1.0)}
                    className="px-2 py-1 rounded bg-[#17231c] hover:bg-[#223429] border border-white/12 font-mono text-[10.5px] text-[#cfe0cd] flex items-center gap-1 cursor-pointer"
                  >
                    <Zap className="w-3 h-3 text-[#e0b86d]" />
                    {evtType}
                  </button>
                ))}
              </div>
            </div>

            {/* Adaptive Music Controls */}
            <div className="rounded bg-[#111914] border border-white/10 p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] uppercase tracking-wider text-[#95ab94]">
                  Adaptive Music Bus
                </span>
                <label className="flex items-center gap-2 text-xs cursor-pointer">
                  <input
                    type="checkbox"
                    checked={snapshot.music.enabled}
                    onChange={(e) => onSetMusicEnabled(e.target.checked)}
                    className="accent-[#7fb382]"
                  />
                  <span>Enabled</span>
                </label>
              </div>
              <div className="flex items-center gap-3">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.02}
                  value={snapshot.music.volume}
                  onChange={(e) => onSetMusicVolume(parseFloat(e.target.value))}
                  aria-label="Music volume"
                  className="flex-1 h-1.5 rounded bg-[#233328] accent-[#7fb382] cursor-pointer"
                />
                <span className="w-12 text-right font-mono tabular-nums text-[11px] text-[#d6e4d4]">
                  {Math.round(snapshot.music.volume * 100)}%
                </span>
              </div>
            </div>

            {/* Hierarchical Bus Mixer */}
            <div className="rounded bg-[#111914] border border-white/10 p-3 space-y-2">
              <div className="text-[10px] uppercase tracking-wider text-[#95ab94]">
                Bus Mixer ({snapshot.buses.length})
              </div>
              <div className="space-y-2">
                {snapshot.buses.map((b) => (
                  <div key={b.id} className="flex items-center gap-2 font-mono text-[11px]">
                    <button
                      type="button"
                      onClick={() => onSetBusMuted(b.id, !b.muted)}
                      aria-label={`Toggle mute for ${b.id}`}
                      className={`w-6 h-6 flex items-center justify-center rounded border cursor-pointer ${
                        b.muted
                          ? 'bg-[#3d201e] border-[#a85c54] text-[#f0aba4]'
                          : 'bg-[#17231c] border-white/12 text-[#cfe0cd]'
                      }`}
                    >
                      {b.muted ? (
                        <VolumeX className="w-3 h-3" />
                      ) : (
                        <Volume2 className="w-3 h-3" />
                      )}
                    </button>
                    <div className="w-44 truncate text-[#d7e5d5]" title={b.id}>
                      {b.id}
                      <span className="text-[10px] text-[#7c907b]"> ({b.activeVoices})</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1.5}
                      step={0.05}
                      value={b.volume}
                      onChange={(e) => onSetBusVolume(b.id, parseFloat(e.target.value))}
                      aria-label={`Volume for ${b.id}`}
                      className="flex-1 h-1.5 rounded bg-[#233328] accent-[#7fb382] cursor-pointer"
                    />
                    <span className="w-10 text-right tabular-nums text-[#a6baa5]">
                      {b.effectiveGain.toFixed(2)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {tab === 'config' && (
          <div className="flex flex-col h-full gap-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[10px] uppercase tracking-wider text-[#95ab94]">
                Live JSON Config Hot-Reload
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid="diag-config-load-btn"
                  onClick={handleLoadCurrentJson}
                  className="px-2.5 py-1 rounded bg-[#18241d] hover:bg-[#233429] border border-white/14 text-[11px] text-[#dce8da] flex items-center gap-1 cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3" />
                  Load Current
                </button>
                <button
                  type="button"
                  data-testid="diag-config-apply-btn"
                  onClick={handleApplyReload}
                  className="px-3 py-1 rounded bg-[#2d4a34] hover:bg-[#3a6043] border border-[#729e7a]/60 text-[11px] font-medium text-[#eef5ec] cursor-pointer"
                >
                  Validate & Hot-Reload
                </button>
              </div>
            </div>

            {reloadStatus && (
              <div
                data-testid="diag-config-status"
                className={`p-2.5 rounded border text-[11px] font-mono ${
                  reloadStatus.ok
                    ? 'bg-[#122618] border-[#619c6c] text-[#bfe8c4]'
                    : 'bg-[#2a1414] border-[#b05b54] text-[#f4b9b2]'
                }`}
              >
                <div className="font-semibold">{reloadStatus.message}</div>
                {reloadStatus.issues.length > 0 && (
                  <ul className="mt-1 space-y-0.5 text-[10.5px] list-disc pl-4">
                    {reloadStatus.issues.slice(0, 8).map((iss, idx) => (
                      <li key={idx}>
                        [{iss.severity}] {iss.file}/{iss.definition}.{iss.property}: {iss.message}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <textarea
              data-testid="diag-config-editor"
              value={configText}
              onChange={(e) => setConfigText(e.target.value)}
              spellCheck={false}
              className="flex-1 min-h-[340px] w-full p-2.5 rounded bg-[#080d0a] border border-white/15 font-mono text-[11px] leading-relaxed text-[#d7e5d5] focus:outline-none focus:border-[#78a180]"
            />
          </div>
        )}
      </div>
    </aside>
  );
};
