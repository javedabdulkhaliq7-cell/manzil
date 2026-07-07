// Supabase Edge Function: ai-tutor
// Receives a student's question + current chapter context, calls DeepSeek
// server-side (API key never reaches the browser), returns the reply.
//
// Deploy with: supabase functions deploy ai-tutor
// Set the secret with: supabase secrets set DEEPSEEK_API_KEY=sk-xxxxx

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const DEEPSEEK_API_KEY = Deno.env.get('DEEPSEEK_API_KEY')
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
    if (!DEEPSEEK_API_KEY) {
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
      .select('plan, ai_used_today, ai_reset_date')
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
    let systemPrompt = 'You are a friendly, encouraging AI tutor for Pakistani board exam students (Balochistan Board). Keep answers clear, simple, and exam-focused. Use short paragraphs or bullet points. Relate concepts back to common board-exam MCQ traps where relevant.'

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
        systemPrompt += '\nOnly answer questions related to this subject and chapter. If asked something unrelated, gently redirect the student back to their current chapter.'
      }
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      ...(body.history ?? []).slice(-10), // keep the last few turns only, controls cost
      { role: 'user', content: body.message },
    ]

    const deepseekRes = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        messages,
        max_tokens: 500,
        temperature: 0.6,
      }),
    })

    if (!deepseekRes.ok) {
      const errText = await deepseekRes.text()
      console.error('DeepSeek error:', errText)
      return new Response(JSON.stringify({ error: 'AI tutor is temporarily unavailable. Please try again.' }), {
        status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const data = await deepseekRes.json()
    const reply = data?.choices?.[0]?.message?.content ?? 'Sorry, I could not generate a response. Please try again.'

    // Increment usage server-side — this is the source of truth, not the client
    await supabase.from('profiles').update({
      ai_used_today: usedToday + 1,
      ai_reset_date: today,
    }).eq('id', user.id)

    return new Response(JSON.stringify({ reply }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('ai-tutor function error:', err)
    return new Response(JSON.stringify({ error: 'Something went wrong. Please try again.' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
