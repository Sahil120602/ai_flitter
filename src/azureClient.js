const axios = require("axios");
const { DEFAULT_FILTERS, SYSTEM_PROMPT } = require("./constants");

function normalizeFilters(rawFilters) {
  return {
    ...DEFAULT_FILTERS,
    ...rawFilters,
    nirf_ranking_max:
      rawFilters && rawFilters.nirf_ranking_max != null
        ? Number(rawFilters.nirf_ranking_max)
        : null,
    min_package_lpa:
      rawFilters && rawFilters.min_package_lpa != null
        ? Number(rawFilters.min_package_lpa)
        : null,
  };
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (e) {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      const maybeJson = trimmed.slice(firstBrace, lastBrace + 1);
      try {
        return JSON.parse(maybeJson);
      } catch (innerError) {
        return null;
      }
    }
    return null;
  }
}

async function extractFiltersFromQuery(query, azureConfig) {
  const url = `${azureConfig.endpoint.replace(/\/$/, "")}/openai/deployments/${azureConfig.deployment}/chat/completions?api-version=${azureConfig.apiVersion}`;

  try {
    const response = await axios.post(
      url,
      {
        temperature: 0,
        max_tokens: 500,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: query },
        ],
      },
      {
        headers: {
          "Content-Type": "application/json",
          "api-key": azureConfig.apiKey,
        },
        timeout: 20000,
      }
    );

    const content = response.data?.choices?.[0]?.message?.content;
    const parsed = extractJsonObject(content);

    if (!parsed || typeof parsed !== "object") {
      return {
        filters: { ...DEFAULT_FILTERS, keyword: query },
        aiError: "AI response was not valid JSON",
      };
    }

    return {
      filters: normalizeFilters(parsed),
      aiError: null,
    };
  } catch (error) {
    return {
      filters: { ...DEFAULT_FILTERS, keyword: query },
      aiError: error.message || "Azure OpenAI request failed",
    };
  }
}

module.exports = {
  extractFiltersFromQuery,
};
