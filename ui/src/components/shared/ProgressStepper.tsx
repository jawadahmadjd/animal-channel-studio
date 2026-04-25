import { Check, X } from 'lucide-react'
import { useStore } from '../../store/useStore'

type StepState = 'idle' | 'active' | 'complete' | 'error'

const STEPS = [
  'Log In',
  'Ideate',
  'Script',
  'Narrate',
  'Voiceover',
  'Pick Story',
  'Configure',
  'Generate',
]

function stepState(step: number, activeStep: number, runState: string): StepState {
  if (step < activeStep) return 'complete'
  if (step === activeStep) {
    if (runState === 'error') return 'error'
    if (runState === 'complete') return 'complete'
    return 'active'
  }
  return 'idle'
}

export default function ProgressStepper() {
  const { activeStep, runState } = useStore()
  const activeLabel = STEPS[activeStep - 1] ?? ''

  return (
    <div className="rounded-2xl px-8 py-6 mb-8 bg-white border border-slate-100 shadow-sm">
      {/* Step circles row */}
      <div className="flex items-center justify-between">
        {STEPS.map((_, i) => {
          const step = i + 1
          const state = stepState(step, activeStep, runState)
          const isLast = i === STEPS.length - 1

          return (
            <div key={step} className="flex items-center flex-1 last:flex-none">
              <div className="flex flex-col items-center relative z-10">
                <StepCircle step={step} state={state} />
              </div>
              {!isLast && (
                <div className="flex-1 h-0.5 mx-1 -mt-0 bg-slate-100 relative overflow-hidden">
                  <div
                    className="absolute inset-0 bg-emerald-500 transition-all duration-700"
                    style={{ width: state === 'complete' ? '100%' : '0%' }}
                  />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Active step label */}
      <div className="mt-4 text-center">
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-slate-400">
          Step {activeStep} of {STEPS.length}
        </span>
        <span className="mx-2 text-slate-200">·</span>
        <span className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-600">
          {activeLabel}
        </span>
      </div>
    </div>
  )
}

function StepCircle({ step, state }: { step: number; state: StepState }) {
  const base =
    'w-8 h-8 rounded-xl flex items-center justify-center text-xs font-black transition-all duration-500 shadow-sm'

  if (state === 'complete')
    return (
      <div className={`${base} bg-emerald-500 text-white shadow-emerald-100`}>
        <Check size={14} strokeWidth={4} />
      </div>
    )

  if (state === 'error')
    return (
      <div className={`${base} bg-red-500 text-white shadow-red-100`}>
        <X size={14} strokeWidth={4} />
      </div>
    )

  if (state === 'active')
    return (
      <div
        className={`${base} bg-slate-900 text-white shadow-slate-200 scale-110 ring-4 ring-emerald-50`}
      >
        {step}
      </div>
    )

  return (
    <div className={`${base} bg-slate-50 text-slate-300 border border-slate-100`}>{step}</div>
  )
}
