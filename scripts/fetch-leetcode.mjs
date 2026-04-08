import fs from "node:fs";
import * as cheerio from "cheerio";

const LEETCODE_API_ENDPOINT = "https://leetcode.com/graphql";

const QUESTION_DATA_QUERY = `
  query questionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionId
      questionFrontendId
      title
      titleSlug
      isPaidOnly
      difficulty
      likes
      dislikes
      categoryTitle
      topicTags {
        name
        slug
      }
      content
      hints
    }
  }
`;

async function fetchLeetCodeQuestion(slug) {
  console.log(`Fetching data for slug: "${slug}"...`);
  try {
    const response = await fetch(LEETCODE_API_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUESTION_DATA_QUERY, variables: { titleSlug: slug } }),
    });

    if (!response.ok) throw new Error(`HTTP Error: ${response.status} ${response.statusText}`);
    const { data, errors } = await response.json();
    if (errors) {
      console.error("GraphQL Errors:", errors);
      return null;
    }
    return data.question;
  } catch (error) {
    console.error("Fetch failed:", error);
    return null;
  }
}

async function scrapeLeetcodeCa(id) {
  try {
    const url = `https://leetcode.ca/all/${id}.html`;
    console.log(`Fallback triggered -> Scraping ${url}`);
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    
    let content = $("article.post-content").html() || $(".markdown-body").html();
    
    if (content) {
      // leetcode.ca often includes solutions at the bottom. We can strip anything after <h2 id="solution"> or <h2>Solution
      const solutionIndex = content.toLowerCase().indexOf('<h2 id="solution"');
      if (solutionIndex !== -1) {
        content = content.substring(0, solutionIndex);
      }
      return content.trim();
    }
  } catch (e) {
    console.error("Scrape failed", e);
  }
  return null;
}

async function main() {
  const slug = process.argv[2] || "two-sum";
  const questionData = await fetchLeetCodeQuestion(slug);
  
  if (!questionData) {
     console.log("No data found for slug.");
     return;
  }

  let promptHtml = questionData.content;
  let usedFallback = false;

  // Premium lock check
  if (questionData.isPaidOnly || !promptHtml) {
    console.log("Question is Premium/Locked. Attempting leetcode.ca fallback...");
    promptHtml = await scrapeLeetcodeCa(questionData.questionFrontendId);
    usedFallback = true;
  }

  const formattedForDB = {
    slug: questionData.titleSlug,
    source: usedFallback ? "leetcode.ca" : "leetcode",
    source_id: questionData.questionFrontendId,
    source_url: `https://leetcode.com/problems/${questionData.titleSlug}/`,
    title: questionData.title,
    difficulty: questionData.difficulty,
    topics: questionData.topicTags.map(tag => tag.name),
    companies: [], 
    prompt: promptHtml,
    constraints: null, 
    examples: [], 
    hints: questionData.hints || [],
    metadata: {
      isPaidOnly: questionData.isPaidOnly,
      category: questionData.categoryTitle,
      likes: questionData.likes,
      dislikes: questionData.dislikes,
      used_fallback_scraper: usedFallback
    }
  };

  console.log("\n--- FORMATTED DATA FOR DATABASE ---");
  const output = { ...formattedForDB, prompt: formattedForDB.prompt ? formattedForDB.prompt.substring(0, 150) + "... [TRUNCATED]" : null };
  console.log(JSON.stringify(output, null, 2));

  fs.writeFileSync(`${slug}-test.json`, JSON.stringify(formattedForDB, null, 2));
  console.log(`\nFull output saved to ${slug}-test.json`);
}

main();
