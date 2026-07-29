import { CircleStop, LoaderCircle, Pause, Play, Radio, SquareArrowOutUpRight } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { MeetingIndicatorAction, MeetingIndicatorState } from '../../shared/types'

const hiddenState: MeetingIndicatorState = {
  status: 'hidden',
  title: '',
  elapsedMs: 0,
  systemAudio: false
}

function formatElapsed(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function MeetingIndicator(): React.JSX.Element {
  const [state, setState] = useState<MeetingIndicatorState>(hiddenState)

  useEffect(() => {
    void window.desktop.getMeetingIndicatorState().then(setState)
    return window.desktop.onMeetingIndicatorState(setState)
  }, [])

  const control = (action: MeetingIndicatorAction): void => {
    void window.desktop.controlMeeting(action)
  }

  return (
    <div className={`meeting-indicator meeting-indicator-${state.status}`}>
      <span className="meeting-indicator-signal">
        {state.status === 'processing'
          ? <LoaderCircle size={15} className="spin" />
          : <Radio size={15} />}
      </span>
      <button
        className="meeting-indicator-copy"
        aria-label="Open Dictalume meetings"
        onClick={() => void window.desktop.showMainWindow()}
      >
        <strong>{state.title || 'Meeting'}</strong>
        <small>
          {state.status === 'processing'
            ? 'Creating notes…'
            : state.status === 'reviewing'
              ? 'Confirm speakers before notes'
            : `${state.status === 'paused' ? 'Paused' : 'Recording'} · ${formatElapsed(
                state.elapsedMs
              )} · ${state.systemAudio ? 'Both sides' : 'Microphone'}`}
        </small>
      </button>
      {!['processing', 'reviewing'].includes(state.status) && (
        <button
          className="meeting-indicator-control"
          aria-label={state.status === 'paused' ? 'Resume meeting' : 'Pause meeting'}
          onClick={() => control(state.status === 'paused' ? 'resume' : 'pause')}
        >
          {state.status === 'paused' ? <Play size={14} /> : <Pause size={14} />}
        </button>
      )}
      {!['processing', 'reviewing'].includes(state.status) && (
        <button
          className="meeting-indicator-control is-stop"
          aria-label="Stop meeting"
          onClick={() => control('stop')}
        >
          <CircleStop size={15} />
        </button>
      )}
      {(state.status === 'processing' || state.status === 'reviewing') && (
        <button
          className="meeting-indicator-control"
          aria-label="Open Dictalume"
          onClick={() => void window.desktop.showMainWindow()}
        >
          <SquareArrowOutUpRight size={14} />
        </button>
      )}
    </div>
  )
}
