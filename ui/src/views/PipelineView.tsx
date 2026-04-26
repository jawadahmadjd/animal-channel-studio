import { useRef } from 'react'
import Header from '../components/layout/Header'
import ProgressStepper from '../components/shared/ProgressStepper'
import LoginStep from '../components/pipeline/LoginStep'
import IdeaGenerationStep from '../components/pipeline/IdeaGenerationStep'
import ScriptGenerationStep from '../components/pipeline/ScriptGenerationStep'
import VoNarrationStep from '../components/pipeline/VoNarrationStep'
import GenerateVoiceoverStep from '../components/pipeline/GenerateVoiceoverStep'
import PickStoryStep from '../components/pipeline/PickStoryStep'
import SettingsStep from '../components/pipeline/SettingsStep'
import StartStep from '../components/pipeline/StartStep'
import VideoPreview from '../components/monitor/VideoPreview'
import PipelineActivity from '../components/monitor/PipelineActivity'

interface Props {
  scrollRef: React.RefObject<HTMLDivElement>
}

export default function PipelineView({ scrollRef }: Props) {
  return (
    <div className="flex flex-col h-full bg-slate-50">
      <Header title="Video Pipeline" />

      {/* Two-column layout */}
      <div className="flex flex-1 overflow-hidden px-12 py-10 gap-12">
        {/* Left: scrollable pipeline steps */}
        <div
          ref={scrollRef}
          className="overflow-y-auto pr-4 flex flex-col custom-scrollbar"
          style={{ width: 640, flexShrink: 0 }}
        >
          <ProgressStepper />
          <div className="space-y-8">
            <LoginStep />
            <IdeaGenerationStep />
            <ScriptGenerationStep />
            <VoNarrationStep />
            <GenerateVoiceoverStep />
            <PickStoryStep />
            <SettingsStep />
            <StartStep />
          </div>

          <div className="flex-1" style={{ minHeight: '4rem' }} />
        </div>

        {/* Right: monitor panel */}
        <div className="flex-1 flex flex-col min-w-0 gap-8">
          <VideoPreview />
          <PipelineActivity />
        </div>
      </div>
    </div>
  )
}
