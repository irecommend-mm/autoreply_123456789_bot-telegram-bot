const { createClient } = require('@supabase/supabase-js');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const axios = require('axios');

// Bot Configuration
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!TELEGRAM_BOT_TOKEN || !SUPABASE_URL || !SUPABASE_KEY || !GEMINI_API_KEY) {
  throw new Error('Missing required environment variables');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);

exports.handler = async (event, context) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const update = JSON.parse(event.body);
    const message = update.message;
    
    if (!message) {
      return { statusCode: 200, body: 'No message' };
    }

    const chatId = message.chat.id;
    const text = message.text;
    const userId = message.from.id;
    const userName = message.from.first_name || 'User';

    // Store or update lead
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .upsert({
        telegram_id: userId,
        first_name: userName,
        username: message.from.username,
        language_code: message.from.language_code,
        updated_at: new Date().toISOString()
      }, { onConflict: 'telegram_id' })
      .select()
      .single();

    if (leadError) {
      console.error('Lead error:', leadError);
    }

    // Store user message
    if (lead) {
      await supabase.from('messages').insert({
        lead_id: lead.id,
        content: text,
        sender: 'user',
        timestamp: new Date().toISOString()
      });
    }

    // Generate AI response
    const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash-lite' });
    const prompt = `You are a helpful assistant for autoreply_123456789_bot. Respond to: "${text}"`;
    
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const aiResponse = response.text();

    // Send response back to user
    if (chatId !== 123456789) { // Don't send to test chat IDs
      await axios.post(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
        chat_id: chatId,
        text: aiResponse
      });
    }

    // Store bot response
    if (lead) {
      await supabase.from('messages').insert({
        lead_id: lead.id,
        content: aiResponse,
        sender: 'bot',
        timestamp: new Date().toISOString()
      });
    }

    return { statusCode: 200, body: 'OK' };

  } catch (error) {
    console.error('Error:', error);
    return { statusCode: 500, body: 'Internal server error' };
  }
};