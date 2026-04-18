import os
import json
import urllib.request
import urllib.parse
import trafilatura
from supabase import create_client, Client
from datetime import datetime, timezone
from dotenv import load_dotenv

# Load .env from project root
load_dotenv()

# --- Configuration ---
NEWS_API_KEY = os.environ["GNEWS_API_KEY"]
SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

TABLE_NAME = "world_news"

# --- Supabase Setup ---
supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

# All countries now use search mode with keyword queries for consistent,
# high-quality English coverage. Iran and Germany have been removed.
COUNTRIES = {
    "in": {"name": "India",     "mode": "search", "q": "India latest news"},
    "us": {"name": "USA",       "mode": "search", "q": "United States latest news"},
    "au": {"name": "Australia", "mode": "search", "q": "Australia latest news"},
    "cn": {"name": "China",     "mode": "search", "q": "China news"},
    "ru": {"name": "Russia",    "mode": "search", "q": "Russia news"},
}


def build_url(config: dict) -> str:
    """Build the correct GNews API URL depending on the fetch mode."""
    if config["mode"] == "headlines":
        return (
            f"https://gnews.io/api/v4/top-headlines"
            f"?lang=en&country={config['code']}&max=10"
            f"&apikey={NEWS_API_KEY}"
        )
    else:
        # Search mode: query by keyword, English only, sorted by date
        q = urllib.parse.quote(config["q"])
        return (
            f"https://gnews.io/api/v4/search"
            f"?q={q}&lang=en&max=10&sortby=publishedAt"
            f"&apikey={NEWS_API_KEY}"
        )


def fetch_articles_for_country(config: dict) -> list:
    """Fetch up to 10 English articles for a given country."""
    name = config["name"]
    url = build_url(config)

    print(f"\n{'='*60}")
    print(f"Fetching news for: {name} (mode: {config['mode']})")
    print(f"{'='*60}")

    try:
        with urllib.request.urlopen(url, timeout=15) as response:
            data = json.loads(response.read().decode("utf-8"))
    except Exception as e:
        print(f"  ERROR: Failed to fetch from GNews for {name}: {e}")
        return []

    articles = data.get("articles", [])
    print(f"  Retrieved {len(articles)} articles from GNews")
    return articles


def extract_full_content(article_url: str) -> str | None:
    """Download and extract full article text using Trafilatura."""
    try:
        downloaded = trafilatura.fetch_url(article_url)
        if not downloaded:
            return None
        content = trafilatura.extract(
            downloaded,
            include_comments=False,
            include_tables=True,
            no_fallback=False,
            favor_recall=True,
        )
        return content
    except Exception as e:
        print(f"    WARNING: Trafilatura error: {e}")
        return None


def store_article(
    article: dict,
    country_name: str,
    country_code: str,
    seen_urls: set,
    per_country_seen_urls: set,
) -> bool:
    """Upsert a single article. Skips if URL already seen globally or within this country."""
    article_url = article.get("url", "").strip()
    if not article_url:
        print(f"    Skipping article with no URL")
        return False

    # Deduplicate within this country's batch
    if article_url in per_country_seen_urls:
        print(f"    Skipping intra-country duplicate: {article_url[:70]}...")
        return False
    per_country_seen_urls.add(article_url)

    # Deduplicate across all countries in this run
    if article_url in seen_urls:
        print(f"    Skipping cross-country duplicate: {article_url[:70]}...")
        return False
    seen_urls.add(article_url)

    print(f"    Extracting content from: {article_url[:80]}...")
    full_content = extract_full_content(article_url)

    if full_content:
        print(f"    Extracted {len(full_content)} characters")
    else:
        print(f"    Falling back to description")
        full_content = article.get("description") or article.get("content") or None

    source = article.get("source", {})
    source_name = source.get("name") if isinstance(source, dict) else str(source)

    row = {
        "country": country_name,
        "country_code": country_code.upper(),
        "headline": article.get("title"),
        "description": article.get("description"),
        "content": full_content,
        "url": article_url,
        "source_name": source_name,
        "published_at": article.get("publishedAt"),
        "tags": [],
    }

    try:
        supabase.table(TABLE_NAME).insert(row).execute()
        return True
    except Exception as e:
        print(f"    ERROR: Supabase insert error: {e}")
        return False


def main():
    print("\nStarting News Fetcher")
    print(f"Run time: {datetime.now(timezone.utc).isoformat()}\n")

    # Clear all existing data before fresh insert
    print("Clearing existing data from table...")
    try:
        supabase.table(TABLE_NAME).delete().neq("id", 0).execute()
        print("Table cleared.")
    except Exception as e:
        print(f"ERROR: Failed to clear table: {e}")
        raise SystemExit("Aborting to avoid duplicate data.")

    # Track all URLs seen this run to prevent cross-country duplicates
    seen_urls: set = set()

    total_inserted = 0
    total_failed = 0
    total_skipped = 0

    for country_key, config in COUNTRIES.items():
        articles = fetch_articles_for_country(config)
        country_name = config["name"]
        country_code = config.get("code", country_key)

        # Fresh set for each country to catch intra-country dupes
        per_country_seen_urls: set = set()

        inserted_this_country = 0
        for idx, article in enumerate(articles, start=1):
            title = article.get("title", "No title")
            print(f"\n  [{idx}/{len(articles)}] {title[:80]}")

            success = store_article(
                article,
                country_name,
                country_code,
                seen_urls,
                per_country_seen_urls,
            )
            if success:
                total_inserted += 1
                inserted_this_country += 1
            else:
                total_skipped += 1

        print(f"\n  {country_name}: {inserted_this_country} articles stored")

    print(f"\n{'='*60}")
    print(f"Done!")
    print(f"   Inserted/updated : {total_inserted}")
    print(f"   Skipped (dupes)  : {total_skipped}")
    print(f"   Failed           : {total_failed}")
    print(f"{'='*60}\n")


if __name__ == "__main__":
    main()