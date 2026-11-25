"""Offline tests for the scout: every reader is fed a canned response, so no
test touches the network, the Anthropic API or a mailbox.

Run from the repo root:  python -m unittest discover -s scout
"""
import io
import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import scout


class FakeResponse:
    def __init__(self, payload, status=200):
        self._payload, self.status_code = payload, status

    def json(self):
        return self._payload

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"{self.status_code} error")


def reply(payload, status=200):
    return mock.Mock(return_value=FakeResponse(payload, status))


SHAPE = {"id", "title", "location", "url", "company", "source"}


class Readers(unittest.TestCase):
    def check(self, jobs, n, title, url_part):
        self.assertEqual(len(jobs), n)
        self.assertEqual(set(jobs[0]), SHAPE)
        self.assertEqual(jobs[0]["title"], title)
        self.assertIn(url_part, jobs[0]["url"])

    def test_greenhouse(self):
        data = {"jobs": [{"id": 1, "title": "VP Cloud", "location": {"name": "NYC"}, "absolute_url": "https://x/1"}]}
        with mock.patch("scout.requests.get", reply(data)):
            self.check(scout.fetch_greenhouse("acme"), 1, "VP Cloud", "https://x/1")

    def test_lever_drops_drafts(self):
        data = [{"id": "a", "text": "Head of FinOps", "hostedUrl": "https://l/a"}, {"id": "b", "text": "Draft", "draft": True}]
        with mock.patch("scout.requests.get", reply(data)):
            self.check(scout.fetch_lever("acme"), 1, "Head of FinOps", "https://l/a")

    def test_ashby_drops_unlisted(self):
        data = {"jobs": [{"id": "a", "title": "Director", "location": "Remote", "jobUrl": "https://a/a"},
                         {"id": "b", "title": "Hidden", "isListed": False}]}
        with mock.patch("scout.requests.get", reply(data)):
            self.check(scout.fetch_ashby("Acme"), 1, "Director", "https://a/a")

    def test_bamboohr(self):
        data = {"result": [{"id": "89", "jobOpeningName": "Director of Product", "location": {"city": "London", "state": None}}]}
        with mock.patch("scout.requests.get", reply(data)):
            jobs = scout.fetch_bamboohr("acme")
        self.check(jobs, 1, "Director of Product", "acme.bamboohr.com/careers/89")
        self.assertEqual(jobs[0]["location"], "London")

    def test_workday_stops_at_total(self):
        page = {"total": 20, "jobPostings": [{"title": f"Role {i}", "externalPath": f"/job/{i}", "locationsText": "Remote"} for i in range(20)]}
        post = reply(page)
        with mock.patch("scout.requests.post", post):
            jobs = scout.fetch_workday("h.wd1.myworkdayjobs.com/tenant/Site")
        self.check(jobs, 20, "Role 0", "https://h.wd1.myworkdayjobs.com/en-US/Site/job/0")
        self.assertEqual(post.call_count, 1, "a full page that reaches the total must not be re-read")

    def test_amazon_dedupes_across_queries(self):
        data = {"jobs": [{"id_icims": "7", "title": "Principal, FinOps", "normalized_location": "Seattle", "job_path": "/en/jobs/7/x"}]}
        get = reply(data)
        with mock.patch("scout.requests.get", get):
            jobs = scout.fetch_amazon(["finops", "cloud"])
        self.check(jobs, 1, "Principal, FinOps", "https://www.amazon.jobs/en/jobs/7/x")
        self.assertEqual(get.call_count, 2)

    def test_microsoft_makes_one_request(self):
        data = {"data": {"positions": [{"id": 5, "name": "Director, Cost Management", "standardizedLocations": ["US"], "positionUrl": "/careers/job/5"}]}}
        get = reply(data)
        with mock.patch("scout.requests.get", get):
            jobs = scout.fetch_microsoft(["finops", "governance"])
        self.check(jobs, 1, "Director, Cost Management", "/careers/job/5")
        self.assertEqual(get.call_count, 1)
        self.assertEqual(get.call_args.kwargs["params"]["query"], "finops governance")

    def test_ibm(self):
        data = {"hits": {"hits": [{"_id": "z", "_source": {"title": "Director", "url": "https://careers.ibm.com/z", "field_keyword_19": "Austin"}}]}}
        with mock.patch("scout.requests.post", reply(data)):
            self.check(scout.fetch_ibm("director"), 1, "Director", "careers.ibm.com/z")


class Collect(unittest.TestCase):
    def test_failures_are_reported_and_names_attached(self):
        cfg = {"targets": [
            {"name": "Good Co", "ashby": "Good"},
            {"name": "Bad Co", "ashby": "Bad"},
            {"name": "Hand Co", "custom_ats": True, "note": "check by hand"},
        ]}

        def fake(token):
            if token == "Bad":
                raise RuntimeError("404")
            return [{"id": "ab:1", "title": "VP", "location": "", "url": "u", "company": token, "source": "ashby"}]

        with mock.patch.dict(scout.FETCHERS, {"ashby": fake}):
            jobs, failures, manual_checks = scout.collect(cfg)
        self.assertEqual([j["company_name"] for j in jobs], ["Good Co"])
        self.assertEqual(len(failures), 1)
        self.assertIn("Bad Co (ashby:Bad)", failures[0])
        self.assertEqual(manual_checks, ["Hand Co: check by hand"])

    def test_only_unexpected_failures_add_the_digest_warning(self):
        cfg = {"targets": [
            {"name": "Northwind", "ashby": "northwind"},
            {"name": "Fabrikam", "custom_ats": True, "note": "check by hand"},
        ]}
        for outage in (False, True):
            with self.subTest(outage=outage), mock.patch.dict(scout.FETCHERS, {
                "ashby": mock.Mock(return_value=[], side_effect=RuntimeError("503") if outage else None),
            }):
                jobs, failures, manual_checks = scout.collect(cfg)
                self.assertEqual(jobs, [])
                self.assertEqual(manual_checks, ["Fabrikam: check by hand"])
                digest = scout.build_digest([], failures)
                self.assertEqual(digest.splitlines().count("A few sources could not be read today."), int(outage))
                self.assertNotIn("Fabrikam", digest)

    def test_shipped_config_names_only_known_sources(self):
        import yaml
        cfg = yaml.safe_load((Path(scout.__file__).parent / "config.yaml").read_text())
        for target in cfg["targets"]:
            has_source = any(target.get(kind) for kind in scout.FETCHERS)
            self.assertTrue(has_source or target.get("custom_ats"), f"{target['name']} has no source and is not marked custom_ats")


class Filtering(unittest.TestCase):
    def test_title_filter(self):
        cfg = {"title_must_match_any": ["director", "vp"], "title_none_any": ["intern", "associate"]}
        jobs = [{"title": t} for t in ("Director of FinOps", "Associate Director", "VP Cloud", "Engineer")]
        self.assertEqual([j["title"] for j in scout.filter_titles(jobs, cfg)], ["Director of FinOps", "VP Cloud"])


class Digest(unittest.TestCase):
    def rows(self):
        job = lambda t: {"title": t, "company_name": "X", "location": "", "url": "u"}
        return [{"job": job("Good"), "fit": 8, "why": ""}, {"job": job("Edge"), "fit": 4, "why": ""},
                {"job": job("Weak"), "fit": 3, "why": ""}, {"job": job("Unscored"), "fit": None, "why": ""}]

    def test_low_scores_are_counted_not_listed(self):
        text = scout.build_digest(self.rows(), [], min_fit=4)
        self.assertIn("Good", text)
        self.assertIn("Edge", text)
        self.assertNotIn("Weak", text)
        self.assertIn("1 more new posting(s) scored below 4/10", text)

    def test_unscored_postings_are_always_listed(self):
        self.assertIn("Unscored", scout.build_digest(self.rows(), [], min_fit=9))

    def test_no_threshold_lists_everything(self):
        text = scout.build_digest(self.rows(), [])
        self.assertIn("Weak", text)
        self.assertNotIn("not listed", text)

    def test_source_errors_stay_in_the_log_not_the_email_or_summary(self):
        failure = "Fabrikam: 503 Server Error for url: https://example.invalid/source"
        with tempfile.TemporaryDirectory() as tmp:
            summary = Path(tmp) / "summary.md"
            env = {"GITHUB_STEP_SUMMARY": str(summary), "SMTP_HOST": "smtp.example.invalid",
                   "DIGEST_FROM": "scout@example.invalid", "DIGEST_TO": "reader@example.invalid"}
            with mock.patch.object(scout, "STATE_PATH", Path(tmp) / "state.json"), \
                 mock.patch.object(scout, "collect", return_value=([], [failure], ["Contoso: check by hand"])), \
                 mock.patch.object(scout.smtplib, "SMTP") as smtp, \
                 mock.patch("sys.stdout", new_callable=io.StringIO) as log, \
                 mock.patch.dict(os.environ, env, clear=True):
                scout.main()
            sent = smtp.return_value.__enter__.return_value.send_message
            sent.assert_called_once()
            message = sent.call_args.args[0]
            self.assertEqual(message["To"], env["DIGEST_TO"])
            for text in (message.get_content(), summary.read_text()):
                self.assertEqual(text.splitlines().count("A few sources could not be read today."), 1)
                self.assertNotIn("Sources not read this run", text)
                self.assertNotIn("503", text)
                self.assertNotIn("https://example.invalid/source", text)
            self.assertIn(f"Sources not read this run:\n  - {failure}", log.getvalue())
            self.assertIn("Sources to check manually:\n  - Contoso: check by hand", log.getvalue())

class DryRun(unittest.TestCase):
    def test_dry_run_sends_nothing_and_saves_no_state(self):
        job = {"id": "x:1", "title": "VP Cloud", "location": "", "url": "u", "company": "x", "source": "x", "company_name": "X"}
        with tempfile.TemporaryDirectory() as tmp:
            state = Path(tmp) / "state.json"
            env = {"DRY_RUN": "true"}
            with mock.patch.object(scout, "STATE_PATH", state), \
                 mock.patch.object(scout, "collect", return_value=([job], [], [])), \
                 mock.patch.object(scout, "send_digest") as send, \
                 mock.patch.dict(os.environ, env, clear=True):
                scout.main()
            send.assert_not_called()
            self.assertFalse(state.exists(), "a dry run must not mark postings as seen")


if __name__ == "__main__":
    unittest.main()
