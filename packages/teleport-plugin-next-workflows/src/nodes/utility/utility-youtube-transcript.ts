import { NodeHandlerGenerator, handlerToString } from '../types'

async function utility_youtube_transcript(config: any, context: Record<string, unknown>) {
  const videoUrl = config.videoUrl || ''
  const language = config.language || 'en'

  if (!videoUrl) {
    return { transcript: null, segments: [], videoId: null, error: 'No video URL provided' }
  }

  try {
    let videoId = ''
    if (videoUrl.indexOf('youtu.be/') !== -1) {
      videoId = videoUrl.split('youtu.be/')[1].split(/[?&#]/)[0]
    } else if (videoUrl.indexOf('v=') !== -1) {
      videoId = videoUrl.split('v=')[1].split(/[?&#]/)[0]
    } else if (videoUrl.indexOf('/embed/') !== -1) {
      videoId = videoUrl.split('/embed/')[1].split(/[?&#]/)[0]
    } else if (videoUrl.indexOf('/shorts/') !== -1) {
      videoId = videoUrl.split('/shorts/')[1].split(/[?&#]/)[0]
    } else if (/^[a-zA-Z0-9_-]{11}$/.test(videoUrl.trim())) {
      videoId = videoUrl.trim()
    } else {
      return {
        transcript: null,
        segments: [],
        videoId: null,
        error: 'Could not extract video ID from URL',
      }
    }

    if (!videoId || videoId.length !== 11) {
      return {
        transcript: null,
        segments: [],
        videoId,
        error: 'Invalid video ID: ' + videoId,
      }
    }

    const __nodeRequire =
      typeof __non_webpack_require__ !== 'undefined' ? __non_webpack_require__ : require
    const YT = __nodeRequire('youtube-transcript')
    const TranscriptApi = YT.YoutubeTranscript || YT.default || YT

    const fetchFn = TranscriptApi.fetchTranscript || TranscriptApi.getTranscript
    if (!fetchFn) {
      return {
        transcript: null,
        segments: [],
        videoId,
        error: 'youtube-transcript API not found',
      }
    }

    const rawSegments = await fetchFn.call(TranscriptApi, videoId, { lang: language })

    const segments: any[] = []
    let fullText = ''

    for (let s = 0; s < rawSegments.length; s++) {
      const seg = rawSegments[s]
      let text = seg.text || seg.snippet || ''
      const offset =
        seg.offset !== undefined ? seg.offset : seg.start !== undefined ? seg.start * 1000 : 0
      const duration = seg.duration !== undefined ? seg.duration : 0

      text = text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&#39;/g, "'")
        .replace(/&quot;/g, '"')

      segments.push({
        text,
        offset,
        duration,
        startTime: Math.floor(offset / 1000),
      })

      if (fullText) {
        fullText += ' '
      }
      fullText += text
    }

    return {
      transcript: fullText,
      segments,
      videoId,
      segmentCount: segments.length,
    }
  } catch (err: unknown) {
    let videoIdFallback = ''
    if (videoUrl.indexOf('v=') !== -1) {
      videoIdFallback = videoUrl.split('v=')[1].split(/[?&#]/)[0]
    }
    return {
      transcript: null,
      segments: [],
      videoId: videoIdFallback || null,
      error: (err as Error).message,
    }
  }
}
export const utilityYoutubeTranscript: NodeHandlerGenerator = {
  nodeType: 'utility-youtube-transcript',
  executionEnv: 'server',
  dependencies: {
    'youtube-transcript': '^1.2.0',
  },
  generateHandler(): string {
    return handlerToString(utility_youtube_transcript)
  },
}
