const axios = require('axios');
const EmailHistory = require('../models/EmailHistory');

// ==========================================
// Config
// ==========================================

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_MODEL = 'openai/gpt-oss-120b'; // or 'openai/gpt-oss-20b' for lighter/faster
const DEFAULT_MAX_TOKENS = 3000;
const RETRY_MAX_TOKENS = 5000;

const SYSTEM_PROMPT = `
You are a professional job email writer.

Create professional job outreach content based on the user's request.

The user may provide a short request such as:
- Backend developer
- React developer
- Software engineer
- SDE role
- Startup job

Make reasonable assumptions when the request is short.

Do not invent specific companies, employers, years of experience, certifications, or achievements.

Return ONLY one JSON object.

The JSON must contain exactly these four properties:

subject
emailBody
linkedInDM
followUpEmail

Example structure:

{
  "subject": "Backend Developer Interested in Your Team",
  "emailBody": "Hi Hiring Manager, I noticed your team is...",
  "linkedInDM": "Hi, I noticed your team is hiring...",
  "followUpEmail": "Hi, I wanted to follow up..."
}

Rules:

subject:
6 to 9 words.

emailBody:
60 to 90 words.
Professional.
Include a clear call to action.

linkedInDM:
30 to 50 words.
Short and conversational.

followUpEmail:
50 to 80 words.
Professional follow-up with a new angle.

IMPORTANT:
Return ONLY JSON.
Do not use markdown.
Do not use code fences.
Do not add any explanation.
`;

// ==========================================
// Helper: call Groq
// ==========================================

const callGroq = async (groqApiKey, userPrompt, maxTokens) => {
    return axios.post(
        GROQ_URL,
        {
            model: GROQ_MODEL,
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: userPrompt }
            ],
            temperature: 0.5,
            max_completion_tokens: maxTokens,
            reasoning_effort: 'low', // keeps reasoning from eating the token budget
            response_format: { type: 'json_object' } // forces valid JSON output
        },
        {
            headers: {
                Authorization: `Bearer ${groqApiKey}`,
                'Content-Type': 'application/json'
            },
            timeout: 30000
        }
    );
};

// ==========================================
// Generate Email
// ==========================================

exports.generateEmail = async (req, res) => {
    try {
        const { prompt } = req.body;

        // ------------------------------
        // Validate prompt
        // ------------------------------

        if (!prompt) {
            return res.status(400).json({
                message: 'Prompt is required'
            });
        }

        if (typeof prompt !== 'string') {
            return res.status(400).json({
                message: 'Prompt must be a string'
            });
        }

        if (prompt.trim().length === 0) {
            return res.status(400).json({
                message: 'Prompt cannot be empty'
            });
        }

        if (prompt.length > 2000) {
            return res.status(400).json({
                message: 'Prompt cannot exceed 2000 characters'
            });
        }

        // ------------------------------
        // Groq API key
        // ------------------------------

        const groqApiKey = process.env.GROQ_API_KEY;

        if (!groqApiKey) {
            return res.status(500).json({
                message: 'AI service is not configured'
            });
        }

        // ------------------------------
        // Call Groq (retry once if truncated)
        // ------------------------------

        const cleanPrompt = prompt.trim();

        let aiResponse = await callGroq(
            groqApiKey,
            cleanPrompt,
            DEFAULT_MAX_TOKENS
        );

        let choice = aiResponse.data?.choices?.[0];

        if (choice?.finish_reason === 'length') {
            console.warn(
                'Groq response truncated, retrying with higher limit. Usage:',
                aiResponse.data?.usage
            );

            aiResponse = await callGroq(
                groqApiKey,
                cleanPrompt,
                RETRY_MAX_TOKENS
            );

            choice = aiResponse.data?.choices?.[0];
        }

        // ------------------------------
        // Validate Groq response
        // ------------------------------

        if (!choice || !choice.message) {
            throw new Error('Invalid response from Groq API');
        }

        // Log only token usage (not the full response)
        console.log('GROQ USAGE:', aiResponse.data?.usage);

        if (choice.finish_reason === 'length') {
            console.error('Response still truncated after retry');

            return res.status(502).json({
                message: 'AI response was cut off',
                error: 'Please try again.'
            });
        }

        const generatedText = choice.message.content;

        if (!generatedText || !generatedText.trim()) {
            console.error(
                'Empty AI content. Finish reason:',
                choice.finish_reason,
                'Usage:',
                aiResponse.data?.usage
            );

            throw new Error('AI returned an empty response');
        }

        // ------------------------------
        // Clean AI response
        // ------------------------------

        let cleanedText = generatedText.trim();

        // Remove markdown code fences if the model adds them
        cleanedText = cleanedText
            .replace(/^```json\s*/i, '')
            .replace(/^```\s*/i, '')
            .replace(/\s*```$/i, '')
            .trim();

        // ------------------------------
        // Extract JSON
        // ------------------------------

        const startIndex = cleanedText.indexOf('{');
        const endIndex = cleanedText.lastIndexOf('}');

        if (startIndex === -1 || endIndex === -1) {
            console.error('AI did not return JSON:', generatedText);

            return res.status(500).json({
                message: 'AI did not return valid JSON',
                error: 'Please try again.'
            });
        }

        const jsonText = cleanedText.substring(startIndex, endIndex + 1);

        // ------------------------------
        // Parse JSON
        // ------------------------------

        let parsedResponse;

        try {
            parsedResponse = JSON.parse(jsonText);
        } catch (parseError) {
            console.error('JSON parse error:', parseError.message);
            console.error('JSON received:', jsonText);

            return res.status(500).json({
                message: 'Failed to parse AI response',
                error: 'The AI returned malformed JSON. Please try again.'
            });
        }

        // ------------------------------
        // Validate AI fields
        // ------------------------------

        const emailData = {
            subject: parsedResponse.subject || '',
            emailBody: parsedResponse.emailBody || '',
            linkedInDM: parsedResponse.linkedInDM || '',
            followUpEmail: parsedResponse.followUpEmail || ''
        };

        if (!emailData.subject) {
            return res.status(500).json({
                message: 'AI response is missing subject'
            });
        }

        if (!emailData.emailBody) {
            return res.status(500).json({
                message: 'AI response is missing email body'
            });
        }

        if (!emailData.linkedInDM) {
            return res.status(500).json({
                message: 'AI response is missing LinkedIn message'
            });
        }

        if (!emailData.followUpEmail) {
            return res.status(500).json({
                message: 'AI response is missing follow-up email'
            });
        }

        // ------------------------------
        // Save history
        // ------------------------------

        const historyEntry = await EmailHistory.create({
            userId: req.user._id,
            prompt: cleanPrompt,
            subject: emailData.subject,
            emailBody: emailData.emailBody,
            linkedInDM: emailData.linkedInDM,
            followUpEmail: emailData.followUpEmail
        });

        // ------------------------------
        // Return response
        // ------------------------------

        return res.status(200).json(historyEntry);

    } catch (error) {
        console.error(
            'AI Generation Error:',
            error.response?.data || error.message
        );

        // Rate limit
        if (error.response?.status === 429) {
            return res.status(429).json({
                message: 'Too many requests. Please wait a moment before trying again.',
                error: 'Rate limit exceeded'
            });
        }

        // Authentication
        if (error.response?.status === 401) {
            return res.status(401).json({
                message: 'Invalid Groq API key',
                error: 'Please check your GROQ_API_KEY.'
            });
        }

        // Bad request
        if (error.response?.status === 400) {
            return res.status(400).json({
                message: 'Invalid request sent to Groq',
                error:
                    error.response?.data?.error?.message ||
                    'Groq rejected the request.'
            });
        }

        // Timeout
        if (error.code === 'ECONNABORTED') {
            return res.status(504).json({
                message: 'AI request timed out',
                error: 'Please try again.'
            });
        }

        // General error
        return res.status(500).json({
            message: 'Failed to generate email',
            error:
                error.response?.data?.error?.message ||
                error.message
        });
    }
};

// ==========================================
// Get Email History
// ==========================================

exports.getHistory = async (req, res) => {
    try {
        const history = await EmailHistory
            .find({ userId: req.user._id })
            .sort({ createdAt: -1 });

        return res.status(200).json(history);

    } catch (error) {
        console.error('History Error:', error.message);

        return res.status(500).json({
            message: 'Failed to fetch history'
        });
    }
};