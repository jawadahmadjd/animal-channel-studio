import { useEffect, useState } from 'react'
import { Trash2, XCircle, ChevronDown, Mic2, Film } from 'lucide-react'
import { useStore } from '../../store/useStore'
import { api, type IdeaDbEntry } from '../../api/client'
import StepCard from './StepCard'

export default function PickStoryStep() {
  const {
    runState, setSelectedStoryId, setSelectedStoryTitle, activeStep,
  } = useStore()

  const [dbIdeas, setDbIdeas] = useState<IdeaDbEntry[]>([])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const [expandedSection, setExpandedSection] = useState<'script' | 'vo' | null>(null)
  const [removing, setRemoving] = useState(false)
  const [clearing, setClearing] = useState(false)
  const [actionError, setActionError] = useState('')

  async function loadDb() {
    try {
      const ideas = await api.getIdeasDb()
      setDbIdeas(ideas)
      setSelectedIndex(0)
    } catch {
      setDbIdeas([])
    }
  }

  useEffect(() => {
    loadDb()
  }, [])

  useEffect(() => {
    if (activeStep === 6) loadDb()
  }, [activeStep])

  const selected = dbIdeas[selectedIndex] ?? null

  useEffect(() => {
    if (selected && selected.vo_narrations.length > 0) {
      setSelectedStoryId(selected.story_id)
      setSelectedStoryTitle(selected.title)
    } else {
      setSelectedStoryId('')
      setSelectedStoryTitle('')
    }
  }, [selected, setSelectedStoryId, setSelectedStoryTitle])

  async function handleRemoveIdea() {
    if (!selected) return
    if (!confirm(`Remove "${selected.title}" permanently? This deletes the saved idea, metadata, and any saved run progress for it.`)) return
    setRemoving(true)
    setActionError('')
    try {
      await api.deleteIdeaFromDb(selected.story_id)
      setSelectedStoryId('')
      setSelectedStoryTitle('')
      await loadDb()
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to remove idea')
    } finally {
      setRemoving(false)
    }
  }

  async function handleClearMetadata() {
    if (!selected) return
    if (!confirm(`Clear all metadata for "${selected.title}"? The idea stays in Ideas.md but script, VO narrations and VEO prompts will be deleted. You can regenerate them from Steps 3–4.`)) return
    setClearing(true)
    setActionError('')
    try {
      await api.clearIdeaMetadata(selected.story_id)
      setSelectedStoryId('')
      setSelectedStoryTitle('')
      await loadDb()
    } catch (e: unknown) {
      setActionError(e instanceof Error ? e.message : 'Failed to clear metadata')
    } finally {
      setClearing(false)
    }
  }

  const busy = runState === 'running'

  return (
    <StepCard title="6. Pick a Story" subtitle="Select a story with pre-generated metadata to bridge into video generation.">

      {dbIdeas.length === 0 ? (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <p className="text-sm font-bold text-slate-500">No ready ideas yet.</p>
          <p className="text-xs text-slate-400 font-medium max-w-xs leading-relaxed">
            Complete Steps 2 &amp; 4 (Idea → VEO 3 Prompts) and save to the database. Script and voiceover are optional — only the idea and VEO prompts are required here.
          </p>
        </div>
      ) : (
        <>
          {/* Selector row */}
          <div className="relative mb-4">
            <select
              className="w-full px-4 py-3 rounded-xl text-sm font-bold bg-slate-50 border border-slate-100 text-slate-900 outline-none appearance-none focus:border-emerald-500 focus:ring-4 focus:ring-emerald-50 transition-all"
              value={selectedIndex}
              onChange={(e) => { setSelectedIndex(Number(e.target.value)); setExpandedSection(null); setActionError('') }}
            >
              {dbIdeas.map((idea, i) => (
                <option key={idea.story_id} value={i}>
                  {idea.title}
                </option>
              ))}
            </select>
            <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-slate-400">
              <ChevronDown size={14} />
            </div>
          </div>

          {/* Metadata preview */}
          {selected && (
            <div className="space-y-3 mb-5">
              {/* Description */}
              <div className="px-4 py-3 rounded-xl bg-slate-50 border border-slate-100">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-400 mb-1">Description</p>
                <p className="text-sm text-slate-700 font-medium leading-relaxed">{selected.description}</p>
              </div>

              {selected.vo_narrations.length === 0 && (
                <div className="px-4 py-3 rounded-xl bg-amber-50 border border-amber-100">
                  <p className="text-xs font-bold text-amber-700">
                    Metadata is empty. Regenerate narration and VEO prompts before using this story for Flow.
                  </p>
                </div>
              )}

              {/* Script preview (collapsible) */}
              <div className="rounded-xl border border-slate-100 overflow-hidden">
                <button
                  onClick={() => setExpandedSection(expandedSection === 'script' ? null : 'script')}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <Film size={12} /> Script
                  </span>
                  <ChevronDown
                    size={13}
                    className={`text-slate-400 transition-transform ${expandedSection === 'script' ? 'rotate-180' : ''}`}
                  />
                </button>
                {expandedSection === 'script' && (
                  <div className="px-4 py-3 border-t border-slate-100 max-h-48 overflow-y-auto custom-scrollbar">
                    <p className="text-xs text-slate-700 font-medium leading-relaxed whitespace-pre-wrap">{selected.script}</p>
                  </div>
                )}
              </div>

              {/* VO Narrations preview (collapsible) */}
              <div className="rounded-xl border border-slate-100 overflow-hidden">
                <button
                  onClick={() => setExpandedSection(expandedSection === 'vo' ? null : 'vo')}
                  className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  <span className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-slate-500">
                    <Mic2 size={12} /> {selected.vo_narrations.length} VO Narrations &amp; VEO 3 Prompts
                  </span>
                  <ChevronDown
                    size={13}
                    className={`text-slate-400 transition-transform ${expandedSection === 'vo' ? 'rotate-180' : ''}`}
                  />
                </button>
                {expandedSection === 'vo' && (
                  <div className="border-t border-slate-100 divide-y divide-slate-100 max-h-64 overflow-y-auto custom-scrollbar">
                    {selected.vo_narrations.map((item, i) => (
                      <div key={i} className="px-4 py-3 space-y-1">
                        <p className="text-[10px] font-black uppercase tracking-widest text-slate-400">Scene {i + 1}</p>
                        <p className="text-xs text-slate-700 font-medium leading-relaxed">{item.narration}</p>
                        <p className="text-[11px] text-violet-600 font-medium leading-relaxed italic">{item.veo_prompt}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Management actions */}
          <div className="flex gap-2 flex-wrap">
            <ActionBtn
              icon={<XCircle size={14} />}
              label={clearing ? 'Clearing…' : 'Clear Metadata'}
              onClick={handleClearMetadata}
              disabled={busy || !selected || clearing || removing}
              title="Delete saved script/VO/prompts so you can regenerate them. Idea stays in Ideas.md."
              variant="warn"
            />
            <ActionBtn
              icon={<Trash2 size={14} />}
              label={removing ? 'Removing…' : 'Remove Idea'}
              onClick={handleRemoveIdea}
              disabled={busy || !selected || removing || clearing}
              title="Permanently delete this idea from the database and Ideas.md."
              variant="danger"
            />
          </div>

          {actionError && (
            <p className="mt-3 text-xs font-bold text-red-500 bg-red-50 px-4 py-2 rounded-lg border border-red-100">
              {actionError}
            </p>
          )}
        </>
      )}
    </StepCard>
  )
}

function ActionBtn({
  icon, label, onClick, disabled, title, variant,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled: boolean
  title: string
  variant: 'primary' | 'secondary' | 'warn' | 'danger'
}) {
  const colors = {
    primary:   'bg-emerald-50 text-emerald-600 border-emerald-100 hover:bg-emerald-100',
    secondary: 'bg-slate-50 text-slate-600 border-slate-100 hover:bg-slate-100',
    warn:      'bg-amber-50 text-amber-600 border-amber-100 hover:bg-amber-100',
    danger:    'bg-red-50 text-red-600 border-red-100 hover:bg-red-100',
  }

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-black uppercase tracking-widest border-2 transition-all disabled:opacity-20 ${colors[variant]}`}
    >
      {icon}
      {label}
    </button>
  )
}
