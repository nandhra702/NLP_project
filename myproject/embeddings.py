import os
from dotenv import load_dotenv
from supabase import create_client, Client
from sentence_transformers import SentenceTransformer
from datetime import datetime, timezone

load_dotenv()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)

TABLE_NAME = "world_news"
SIMILAR_TABLE = "similar_articles"
TOP_N = 5  # How many similar articles to store per article

print("🤖 Loading embedding model (all-MiniLM-L6-v2)...")
model = SentenceTransformer("all-MiniLM-L6-v2")
print("✅ Model loaded.\n")


def fetch_all_articles() -> list:
    """Fetch all articles from world_news."""
    print("📥 Fetching all articles from Supabase...")
    try:
        result = supabase.table(TABLE_NAME).select("id, headline, content, description").execute()
        articles = result.data
        print(f"✅ Fetched {len(articles)} articles.\n")
        return articles
    except Exception as e:
        print(f"❌ Failed to fetch articles: {e}")
        raise SystemExit("Aborting.")


def build_text(article: dict) -> str:
    """Combine headline + content into one string for embedding."""
    headline = article.get("headline") or ""
    content = article.get("content") or article.get("description") or ""
    return f"{headline}. {content}".strip()


def generate_embeddings(articles: list) -> list:
    """Generate embeddings for all articles in one batch."""
    print("⚙️  Generating embeddings...")
    texts = [build_text(a) for a in articles]
    embeddings = model.encode(
        texts,
        batch_size=32,
        show_progress_bar=True,
        normalize_embeddings=True,  # Normalizing makes cosine similarity = dot product (faster)
    )
    print(f"✅ Generated {len(embeddings)} embeddings.\n")
    return embeddings


def save_embeddings(articles: list, embeddings) -> None:
    """Write each embedding back to its row in world_news."""
    print("💾 Saving embeddings to Supabase...")
    failed = 0
    for article, embedding in zip(articles, embeddings):
        try:
            supabase.table(TABLE_NAME).update(
                {"embedding": embedding.tolist()}
            ).eq("id", article["id"]).execute()
        except Exception as e:
            print(f"  ❌ Failed to save embedding for article {article['id']}: {e}")
            failed += 1

    print(f"✅ Saved embeddings. Failed: {failed}\n")


def compute_and_store_similar(articles: list, embeddings) -> None:
    """
    Compute cosine similarity between all article pairs,
    store top N most similar per article in similar_articles table.
    Since embeddings are normalized, similarity = dot product.
    """
    import numpy as np

    print("🔁 Computing similarities between all article pairs...")

    # Matrix of shape (n_articles, 384)
    emb_matrix = embeddings  # already a numpy array from model.encode

    # Dot product of normalized vectors = cosine similarity
    # Result: (n_articles, n_articles) similarity matrix
    sim_matrix = np.dot(emb_matrix, emb_matrix.T)

    # Clear old similar_articles data
    print("🗑️  Clearing old similar_articles data...")
    try:
        supabase.table(SIMILAR_TABLE).delete().neq("id", 0).execute()
        print("✅ Cleared.\n")
    except Exception as e:
        print(f"❌ Failed to clear similar_articles: {e}")
        raise SystemExit("Aborting.")

    print(f"💾 Storing top {TOP_N} similar articles per article...")
    rows_to_insert = []

    for i, article in enumerate(articles):
        # Get similarity scores for this article vs all others
        scores = sim_matrix[i]

        # Get indices sorted by similarity descending, exclude self (score == 1.0)
        sorted_indices = scores.argsort()[::-1]
        top_indices = [idx for idx in sorted_indices if idx != i][:TOP_N]

        for j in top_indices:
            rows_to_insert.append({
                "article_id": article["id"],
                "similar_article_id": articles[j]["id"],
                "similarity_score": float(round(scores[j], 6)),
            })

    # Batch insert
    try:
        supabase.table(SIMILAR_TABLE).insert(rows_to_insert).execute()
        print(f"✅ Inserted {len(rows_to_insert)} similarity pairs.\n")
    except Exception as e:
        print(f"❌ Failed to insert similarity pairs: {e}")


def print_sample_recommendations(articles: list) -> None:
    """Print a few example recommendations to verify it's working."""
    print("="*60)
    print("🔍 Sample Recommendations (first 3 articles):")
    print("="*60)

    for article in articles[:3]:
        print(f"\n📰 Source: [{article['headline'][:70]}]")
        try:
            result = (
                supabase.table(SIMILAR_TABLE)
                .select("similar_article_id, similarity_score")
                .eq("article_id", article["id"])
                .order("similarity_score", desc=True)
                .execute()
            )
            pairs = result.data
            for pair in pairs:
                # Fetch the similar article's headline
                sim = supabase.table(TABLE_NAME).select("headline, country").eq("id", pair["similar_article_id"]).execute()
                if sim.data:
                    h = sim.data[0]["headline"]
                    c = sim.data[0]["country"]
                    score = pair["similarity_score"]
                    print(f"   → [{score:.3f}] ({c}) {h[:70]}")
        except Exception as e:
            print(f"  ❌ Could not fetch recommendations: {e}")


def main():
    print("\n🚀 Starting Embedding Generator & Similarity Engine")
    print(f"📅 Run time: {datetime.now(timezone.utc).isoformat()}\n")

    # 1. Fetch all articles
    articles = fetch_all_articles()
    if not articles:
        raise SystemExit("❌ No articles found. Run fetch_news.py first.")

    # 2. Generate embeddings
    embeddings = generate_embeddings(articles)

    # 3. Save embeddings to world_news
    save_embeddings(articles, embeddings)

    # 4. Compute similarities and populate similar_articles
    compute_and_store_similar(articles, embeddings)

    # 5. Print sample output
    print_sample_recommendations(articles)

    print("\n✅ All done! Your similar_articles table is ready.")
    print("="*60)


if __name__ == "__main__":
    main()
