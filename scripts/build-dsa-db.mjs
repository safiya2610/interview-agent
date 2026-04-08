/**
 * scripts/build-dsa-db.mjs
 *
 * ETL Pipeline: Builds a curated JSON bank of company-tagged DSA questions.
 *
 * Steps:
 *  1. Parses All.csv files from `data/interview-company-wise-problems/`
 *     (cloned from github.com/liquidslr/interview-company-wise-problems)
 *  2. Fetches full problem descriptions via LeetCode's GraphQL API.
 *  3. Falls back to scraping leetcode.ca (via sitemap reverse-lookup) for
 *     premium/locked questions not accessible via the public API.
 *  4. Writes deduplicated output to `data/dsa_db_final.json`.
 *
 * Usage:
 *   node scripts/build-dsa-db.mjs
 *
 * Then seed Into Supabase:
 *   node --env-file=.env.local scripts/seed-dsa.mjs data/dsa_db_final.json
 */

import fs from "node:fs";
import path from "node:path";
import { parse } from "csv-parse/sync";
import * as cheerio from "cheerio";
import { createClient } from "@supabase/supabase-js";
import crypto from "node:crypto";

const LEETCODE_API = "https://leetcode.com/graphql";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "http://127.0.0.1:54321"; // fallback for types, needs real env
const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "dummy";

// Maximum number of unique questions to process in this run
const MAX_QUESTIONS_TO_PROCESS = Infinity; 
const CONCURRENCY_LIMIT = 5;

// GraphQL Query
const QUESTION_DATA_QUERY = `
  query questionData($titleSlug: String!) {
    question(titleSlug: $titleSlug) {
      questionId questionFrontendId title titleSlug isPaidOnly difficulty likes dislikes categoryTitle
      topicTags { name slug }
      content hints
    }
  }
`;

// Helper: delays to prevent rate limits
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchGraphQL(slug) {
  try {
    const res = await fetch(LEETCODE_API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: QUESTION_DATA_QUERY, variables: { titleSlug: slug } }),
    });
    if (!res.ok) return null;
    const { data } = await res.json();
    return data?.question;
  } catch (e) {
    return null;
  }
}

async function getSitemapMap() {
  console.log("Downloading leetcode.ca sitemap...");
  const res = await fetch("https://leetcode.ca/sitemap.xml");
  const xml = await res.text();
  const regex = /<loc>(https:\/\/leetcode\.ca\/([^<]+))<\/loc>/g;
  let match;
  const map = {};
  while ((match = regex.exec(xml)) !== null) {
      const url = match[1];
      // Format is roughly https://leetcode.ca/YYYY-MM-DD-{id}-Title/
      const parts = url.split('-');
      // ID is typically the 4th segment or after the date
      // We can just rely on regex looking for -id- when querying
  }
  return xml; // returnsraw because regex on demand is safer
}

async function scrapePremiumFallback(id, sitemapXml) {
  const searchPattern = `-${id}-`;
  const regex = /<loc>(https:\/\/leetcode\.ca\/([^<]+))<\/loc>/g;
  let match;
  let targetUrl = `https://leetcode.ca/all/${id}.html`; // default old
  
  while ((match = regex.exec(sitemapXml)) !== null) {
      if (match[1].includes(searchPattern)) {
          targetUrl = match[1];
          break;
      }
  }

  try {
    const res = await fetch(targetUrl);
    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);
    let content = $("article.post-content").html() || $(".markdown-body").html() || $("article.blog-post").html();
    if (content) {
      const solIdx = content.toLowerCase().indexOf('<h2 id="solution"');
      if (solIdx !== -1) content = content.substring(0, solIdx);
      return { content: content.trim(), url: targetUrl };
    }
  } catch (e) {}
  return null;
}

async function main() {
  const sitemapXml = await getSitemapMap();
  const repoPath = path.resolve("data/interview-company-wise-problems");
  if (!fs.existsSync(repoPath)) {
    console.error("Please run: git clone https://github.com/liquidslr/interview-company-wise-problems.git data/interview-company-wise-problems");
    process.exit(1);
  }

  // 1. Traverse all companies and aggregate into a Slug Map
  console.log("Parsing CSVs to build Company map...");
  const slugMap = new Map();
  const companies = fs.readdirSync(repoPath, { withFileTypes: true })
                      .filter(d => d.isDirectory() && !d.name.startsWith('.'))
                      .map(d => d.name);

  // Process ALL companies in the repository
  for (const company of companies) {
    
    // Read the master "All.csv" or "5. All.csv" to get all questions for the company without duplicate parsing
    const filesToRead = ["5. All.csv", "All.csv"];
    for (const file of filesToRead) {
      const csvPath = path.join(repoPath, company, file);
      if (!fs.existsSync(csvPath)) continue;

      const content = fs.readFileSync(csvPath, "utf-8");
      const records = parse(content, { columns: true, skip_empty_lines: true });

      for (const row of records) {
        if (!row.Link) continue;
        const slugMatch = row.Link.match(/problems\/([^/]+)/);
        if (!slugMatch) continue;
        
        const slug = slugMatch[1];
        if (!slugMap.has(slug)) {
          slugMap.set(slug, {
            slug,
            title: row.Title,
            difficulty: row.Difficulty,
            topics: row.Topics ? row.Topics.split(',').map(t => t.trim()) : [],
            companies: new Set()
          });
        }
        slugMap.get(slug).companies.add(company);
      }
    }
  }

  let slugsToProcess = Array.from(slugMap.values());
  console.log(`Found ${slugsToProcess.length} unique questions across target companies.`);
  
  if (slugsToProcess.length > MAX_QUESTIONS_TO_PROCESS) {
      slugsToProcess = slugsToProcess.slice(0, MAX_QUESTIONS_TO_PROCESS);
      console.log(`Limiting to ${MAX_QUESTIONS_TO_PROCESS} questions for this batch...`);
  }

  const finalDatabaseRows = [];
  
  // 2. Process concurrently with limit
  console.log("Fetching descriptions from Leetcode GraphQL (with leetcode.ca fallback)...");
  
  for (let i = 0; i < slugsToProcess.length; i += CONCURRENCY_LIMIT) {
    const chunk = slugsToProcess.slice(i, i + CONCURRENCY_LIMIT);
    
    await Promise.all(chunk.map(async (meta) => {
      const q = await fetchGraphQL(meta.slug);
      let promptHtml = q?.content;
      let usedFallback = false;
      let isPremium = q?.isPaidOnly || false;
      let sourceUrl = `https://leetcode.com/problems/${meta.slug}/`;

      if (!q) return; // Skip if graphql failed completely

      if (isPremium || !promptHtml) {
        const fb = await scrapePremiumFallback(q.questionFrontendId, sitemapXml);
        if (fb) {
           promptHtml = fb.content;
           usedFallback = true;
           sourceUrl = fb.url;
        }
      }

      if (!promptHtml) {
         console.log(`[SKIP] Could not fetch prompt for ${meta.slug}`);
         return;
      }

      finalDatabaseRows.push({
        slug: meta.slug,
        source: usedFallback ? "leetcode.ca" : "leetcode",
        source_id: q.questionFrontendId,
        source_url: sourceUrl,
        title: q.title,
        difficulty: q.difficulty,
        topics: meta.topics.length ? meta.topics : q.topicTags.map(t => t.name),
        companies: Array.from(meta.companies),
        prompt: promptHtml,
        constraints: null,
        examples: [],
        hints: q.hints || [],
        metadata: {
          isPaidOnly: isPremium,
          category: q.categoryTitle,
          likes: q.likes,
          dislikes: q.dislikes,
          used_fallback_scraper: usedFallback
        }
      });
    }));

    process.stdout.write(`\rProcessed ${Math.min(i + CONCURRENCY_LIMIT, slugsToProcess.length)}/${slugsToProcess.length}`);
    await sleep(500); // 500ms delay between chunks to avoid rate limiting
  }

  console.log("\nSaving to data/dsa_db_final.json");
  fs.writeFileSync(path.resolve("data/dsa_db_final.json"), JSON.stringify(finalDatabaseRows, null, 2));

  // Note: To automatically insert, run `npm run seed:dsa data/dsa_db_final.json`
  console.log(`\nSuccessfully compiled ${finalDatabaseRows.length} questions ready for Supabase seeding!`);
}

main().catch(console.error);
