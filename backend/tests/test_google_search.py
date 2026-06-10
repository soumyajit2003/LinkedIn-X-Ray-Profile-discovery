import pytest

from app.services.google_search import parse_search_results


def test_parse_search_results_valid():
    raw = {
        "organic": [
            {
                "title": "Alice Smith - CEO - HealthCo | LinkedIn",
                "link": "https://www.linkedin.com/in/alicesmith",
                "snippet": "Alice Smith is the CEO of HealthCo, focusing on AI in healthcare...",
            },
            {
                "title": "Bob Jones - CTO | LinkedIn",
                "link": "https://www.linkedin.com/in/bobjones",
                "snippet": "Bob Jones builds medical AI systems...",
            },
        ]
    }
    results = parse_search_results(raw)
    assert len(results) == 2
    assert results[0]["name"] == "Alice Smith - CEO - HealthCo"
    assert results[0]["profile_url"] == "https://www.linkedin.com/in/alicesmith"
    assert results[0]["snippet"] == "Alice Smith is the CEO of HealthCo, focusing on AI in healthcare..."
    assert results[1]["name"] == "Bob Jones - CTO"


def test_parse_search_results_empty():
    results = parse_search_results({})
    assert results == []
    results = parse_search_results({"organic": []})
    assert results == []


def test_parse_search_results_strips_linkedin_suffix():
    raw = {
        "organic": [
            {
                "title": "Jane Doe | LinkedIn",
                "link": "https://www.linkedin.com/in/janedoe",
                "snippet": "Some bio",
            }
        ]
    }
    results = parse_search_results(raw)
    assert results[0]["name"] == "Jane Doe"


def test_parse_search_results_filters_non_linkedin():
    raw = {
        "organic": [
            {
                "title": "Some Company Page | LinkedIn",
                "link": "https://www.linkedin.com/company/someco",
                "snippet": "Company page",
            },
            {
                "title": "Real Person | LinkedIn",
                "link": "https://www.linkedin.com/in/realperson",
                "snippet": "A real profile",
            },
        ]
    }
    results = parse_search_results(raw)
    assert len(results) == 1
    assert results[0]["name"] == "Real Person"


def test_parse_search_results_handles_missing_fields():
    raw = {
        "organic": [
            {
                "title": "No Link Person | LinkedIn",
                "snippet": "Bio text",
            },
            {
                "link": "https://www.linkedin.com/in/noname",
                "snippet": "Bio text",
            },
        ]
    }
    results = parse_search_results(raw)
    assert len(results) == 0
