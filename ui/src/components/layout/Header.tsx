interface Props {
  title: string
}

export default function Header({ title }: Props) {
  return (
    <div
      className="flex items-center justify-between px-12 py-6 bg-slate-50 border-b border-slate-200 overflow-hidden"
      style={{ flexShrink: 0 }}
    >
      <div className="flex flex-col">
        <h1 className="text-3xl font-black tracking-tight text-slate-900">
          {title}
        </h1>
        <p className="text-xs font-bold text-slate-400 uppercase tracking-widest mt-1">
          Automation Workflow
        </p>
      </div>
    </div>
  )
}
