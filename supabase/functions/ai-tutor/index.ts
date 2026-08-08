// Supabase Edge Function: ai-tutor
// Receives a student's question + current chapter context, calls Gemini
// server-side (API key never reaches the browser), returns the reply.
//
// Deploy with: supabase functions deploy ai-tutor
// Set the secret with: supabase secrets set GEMINI_API_KEY=AIza-xxxxx

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

type ReqBody = {
  message: string
  chapterId?: string
  history?: { role: 'user' | 'assistant'; content: string }[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    if (!GEMINI_API_KEY) {
      return new Response(JSON.stringify({ error: 'AI tutor is not configured yet.' }), {
        status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Verify the request comes from a real logged-in user, not an open endpoint
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    )
    if (authError || !user) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Enforce the daily free-tier limit server-side too — never trust the client alone
    const { data: profile } = await supabase
      .from('profiles')
      .select('plan, ai_used_today, ai_reset_date, full_name, name')
      .eq('id', user.id)
      .single()

    const today = new Date().toISOString().split('T')[0]
    const usedToday = profile?.ai_reset_date === today ? (profile?.ai_used_today ?? 0) : 0
    const FREE_AI_LIMIT = 10
    if (profile?.plan === 'free' && usedToday >= FREE_AI_LIMIT) {
      return new Response(JSON.stringify({ error: 'Daily AI Tutor limit reached. Upgrade to Premium for unlimited access.' }), {
        status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const body: ReqBody = await req.json()
    if (!body.message || !body.message.trim()) {
      return new Response(JSON.stringify({ error: 'No message provided' }), {
        status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Build chapter-specific context, so the tutor only answers from the
    // current subject/chapter — this is the "context switching" piece
    let systemPrompt = 'You are a friendly, encouraging AI tutor for Pakistani board exam students (Balochistan Board).'

    const studentName = profile?.full_name || profile?.name
    if (studentName) {
      systemPrompt += ` The student's name is ${studentName}. Address them by name occasionally to keep it personal — for example when greeting them or praising a correct answer — but not in every single message, since that gets repetitive.`
    }

    systemPrompt += `

Writing style rules — follow these strictly:
- Write short, clear sentences. Avoid long sentences with multiple commas strung together.
- One idea per sentence. If a sentence needs more than one comma, split it into two sentences instead.
- Use simple, direct words. Avoid filler phrases like "it is important to note that" or "in order to."
- Use this exact formatting toolkit, nothing else: "## " for a section heading, "**text**" for bold/emphasis, "- " for bullet list items, "1. " for numbered steps. Do not use any other markdown (no backticks, no tables, no italics with single asterisks).
- Use a heading when an answer has more than one distinct part (e.g. "## What it means" then "## Example"). Skip headings for short, single-idea answers.
- Use bullet or numbered lists for anything list-like — steps, examples, MCQ options — instead of cramming them into one sentence.
- Check grammar carefully before answering — no run-on sentences, no dangling clauses.
- Keep paragraphs short: 2-3 sentences max before a line break.
- Match the reading level of a Balochistan Board Class 9 textbook — clear and plain, not academic or flowery.

Content rules:
- Keep answers exam-focused and accurate.
- Relate concepts back to common board-exam MCQ traps where relevant.
- Only answer questions related to the student's subject and chapter. If asked something unrelated, gently redirect back to their current chapter.`

    if (body.chapterId) {
      const { data: chapter } = await supabase
        .from('chapters')
        .select('title, summary, important_topics, subjects(name, class_level)')
        .eq('id', body.chapterId)
        .single()

      if (chapter) {
        const subj: any = chapter.subjects
        systemPrompt += `\n\nThe student is currently studying: ${subj?.name ?? ''} (${subj?.class_level ?? ''}), Chapter: ${chapter.title}.`
        if (chapter.summary) systemPrompt += `\nChapter summary: ${chapter.summary}`
        if (chapter.important_topics?.length) systemPrompt += `\nImportant topics in this chapter: ${chapter.important_topics.join(', ')}.`
      }
    }

    // Gemini doesn't use OpenAI-style role arrays the same way — it wants
    // "user"/"model" roles and a separate system_instruction field.
    const geminiHistory = (body.history ?? []).slice(-6).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }))

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:streamGenerateContent?alt=sse&key=${GEMINI_API_KEY}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [
            ...geminiHistory,
            { role: 'user', parts: [{ text: body.message }] },
          ],
          generationConfig: {
            maxOutputTokens: 1200,
            temperature: 0.35,
          },
        }),
      }
    )

    if (!geminiRes.ok || !geminiRes.body) {
      const errText = await geminiRes.text()
      console.error('Gemini error:', errText)
      return new Response(JSON.stringify({ error: 'AI tutor is temporarily unavailable. Please try again.' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    // Stream Gemini's SSE output straight through to the client as plain text
    // chunks, so the app can reveal the answer word-by-word as it's generated.
    const encoder = new TextEncoder()
    const decoder = new TextDecoder()

    const stream = new ReadableStream({
      async start(controller) {
        const reader = geminiRes.body!.getReader()
        let buffer = ''
        try {
          while (true) {
            const { done, value } = await reader.read()
            if (done) break
            buffer += decoder.decode(value, { stream: true })
            const lines = buffer.split('\n')
            buffer = lines.pop() ?? ''
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const jsonStr = line.slice(6).trim()
              if (!jsonStr) continue
              try {
                const parsed = JSON.parse(jsonStr)
                const piece = parsed?.candidates?.[0]?.content?.parts?.[0]?.text
                if (piece) controller.enqueue(encoder.encode(piece))
              } catch {
                // partial/incomplete JSON line, skip and wait for more data
              }
            }
          }
        } catch (streamErr) {
          console.error('Streaming error:', streamErr)
        } finally {
          controller.close()
          // Increment usage only after the stream actually finished successfully
          await supabase.from('profiles').update({
            ai_used_today: usedToday + 1,
            ai_reset_date: today,
          }).eq('id', user.id)
        }
      },
    })

    return new Response(stream, {
      headers: { ...corsHeaders, 'Content-Type': 'text/plain; charset=utf-8' },
    })
  } catch (err) {
    console.error('ai-tutor function error:', err)
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
