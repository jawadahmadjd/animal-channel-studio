import { ReactNode } from 'react'

interface Props {
  title: string
  subtitle?: string
  children: ReactNode
}

export default function StepCard({ title, subtitle, children }: Props) {
  return (
    <div
      className="rounded-3xl bg-white border border-slate-100 shadow-sm hover:shadow-xl hover:shadow-slate-200/50 transition-all duration-500 overflow-hidden"
    >
      <div className="px-10 pt-10 pb-6">
        <h3 className="text-xl font-black tracking-tight text-slate-900">
          {title}
        </h3>
        {subtitle && (
          <p className="text-sm mt-2 font-medium text-slate-400 leading-relaxed">
            {subtitle}
          </p>
        )}
      </div>
      <div className="px-10 pt-4 pb-10">{children}</div>
    </div>
  )
}
