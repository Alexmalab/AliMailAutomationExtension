// gemini_api.js

/**
 * Calls the Gemini API to determine if an email matches user criteria.
 * @param {string} apiKey The Gemini API key.
 * @param {string} modelName The Gemini model name (e.g., 'gemini-pro').
 * @param {string} systemPrompt The system prompt.
 * @param {string} userPrompt The user-defined prompt.
 * @param {string} emailSubject The subject of the email.
 * @param {string} emailBody The body of the email (can be plain text or HTML).
 * @returns {Promise<boolean>} True if the AI determines a match, false otherwise or on error.
 */
async function checkEmailWithGemini(apiKey, modelName, systemPrompt, userPrompt, emailSubject, emailBody) {
    if (!apiKey) {
        console.error('[GeminiAPI]: API Key is missing.');
        return false;
    }
    if (!modelName) {
        console.error('[GeminiAPI]: Model name is missing.');
        return false;
    }

    const API_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

    // Construct the prompt for the Gemini API
    // We'll combine the system prompt, user prompt, and email content.
    // The exact structure might need refinement based on how Gemini best processes this.
    const fullPrompt = `${systemPrompt}\n\nUser\'s Rule: \"${userPrompt}\"\n\nEmail Subject:\n"""\n${emailSubject}\n"""\n\nEmail Body:\n"""\n${emailBody.substring(0, 15000)}\n"""\n\nDoes this email match the user\'s rule? Respond with only \'MATCH\' or \'NO_MATCH\'.`; // Ensure the body isn't excessively long

    const requestBody = {
        contents: [{
            parts: [{
                text: fullPrompt
            }]
        }],
        // Add safety settings and generation config if needed, based on documentation
        // For now, keeping it simple.
        // safetySettings: [
        //     { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        //     { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        //     { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
        //     { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' }
        // ],
        // generationConfig: {
        //     temperature: 0.2, // For more deterministic output
        //     topK: 1,
        //     topP: 1,
        //     maxOutputTokens: 10, // Expecting short response 'MATCH' or 'NO_MATCH'
        //     stopSequences: []
        // }
    };

    try {
        console.log(`[GeminiAPI]: Sending request to ${modelName} with prompt:`, fullPrompt);
        const response = await fetch(API_ENDPOINT, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const errorData = await response.json();
            console.error('[GeminiAPI]: API request failed:', response.status, errorData);
            return false;
        }

        const responseData = await response.json();
        console.log('[GeminiAPI]: Raw response data:', JSON.stringify(responseData));

        if (responseData.candidates && responseData.candidates.length > 0 &&
            responseData.candidates[0].content && responseData.candidates[0].content.parts &&
            responseData.candidates[0].content.parts.length > 0 &&
            responseData.candidates[0].content.parts[0].text) {
            
            const aiResponseText = responseData.candidates[0].content.parts[0].text.trim().toUpperCase();
            console.log(`[GeminiAPI]: Received response: '${aiResponseText}'`);
            
            if (aiResponseText === 'MATCH') {
                return true;
            } else if (aiResponseText === 'NO_MATCH') {
                return false;
            } else {
                console.warn(`[GeminiAPI]: Unexpected response format. Expected \'MATCH\' or \'NO_MATCH\', got: '${aiResponseText}'`);
                return false; // Or handle as a non-match
            }
        } else {
            console.error('[GeminiAPI]: Could not extract text from Gemini response:', responseData);
            return false;
        }
    } catch (error) {
        console.error('[GeminiAPI]: Error calling Gemini API:', error);
        return false;
    }
} 