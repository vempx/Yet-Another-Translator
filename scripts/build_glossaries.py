"""Build editable name-only dictionaries from public game-localization snapshots.

Uses only the Python standard library. Downloaded source data is cached in the OS
temporary directory; only short name pairs are written into the glossaries.
"""
import datetime
import collections
import hashlib
import io
import json
import pathlib
import re
import sys
import tempfile
import urllib.request
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
CACHE = pathlib.Path(tempfile.gettempdir()) / "YetAnotherTranslator-glossary-source-cache"
CACHE.mkdir(exist_ok=True)
REFRESH = "--refresh" in sys.argv
GENERATED_AT = datetime.datetime.now(datetime.timezone.utc).date().isoformat()


def download(url):
    target = CACHE / hashlib.sha256(url.encode()).hexdigest()
    if REFRESH or not target.exists():
        request = urllib.request.Request(url, headers={"User-Agent": "YetAnotherTranslator-GlossaryBuilder"})
        with urllib.request.urlopen(request, timeout=60) as response:
            data = response.read(100 * 1024 * 1024 + 1)
        if len(data) > 100 * 1024 * 1024:
            raise ValueError("Source exceeds 100 MB")
        target.write_bytes(data)
    return target.read_bytes()


def get_json(url):
    return json.loads(download(url))


def snapshot(repo, branch):
    tree = get_json(f"https://api.github.com/repos/{repo}/git/trees/{branch}?recursive=1")
    return tree["sha"], [row["path"] for row in tree["tree"]]


def raw(repo, sha, path):
    return get_json(f"https://raw.githubusercontent.com/{repo}/{sha}/{path}")


def clean(value):
    if not isinstance(value, str):
        return ""
    value = re.sub(r"<[^>]+>", "", value).strip()
    if len(value) > 160 or "\n" in value or "{" in value or "}" in value:
        return ""
    if re.search(r"test|placeholder|stay tuned|测试|占位", value, re.I):
        return ""
    return value


def add(entries, game, category, en, zh, **extra):
    en, zh = clean(en), clean(zh)
    if en and zh and re.search(r"[A-Za-z]", en) and re.search(r"[\u4e00-\u9fff]", zh):
        entries.append({"game": game, "category": category, "en": en, "zh": zh, **extra})


def ww_glossary():
    repo = "Arikatsu/WutheringWaves_Data"
    sha, paths = snapshot(repo, "3.7")
    maps = {}
    for locale in ["en", "zh-Hans"]:
        maps[locale] = {}
        for path in [f"Textmaps/{locale}/multi_text/MultiText.json", f"Textmaps/{locale}/multi_text_1sthalf/MultiText.json", f"Textmaps/{locale}/multi_text_2ndhalf/MultiText.json"]:
            maps[locale].update({row["Id"]: row["Content"] for row in raw(repo, sha, path)})
    entries = []
    tables = [
        ("BinData/role/roleinfo.json", "Name", "character"),
        ("BinData/skill/skill.json", "SkillName", "skill"),
        ("BinData/item/iteminfo.json", "Name", "resource"),
        ("BinData/weapon/weaponconf.json", "WeaponName", "weapon"),
        ("BinData/element_info/elementinfo.json", "Name", "term")
    ]
    characters = {}
    for path, field, category in tables:
        for row in raw(repo, sha, path):
            if category == "character" and (row.get("IsTrial") or row.get("QualityId", 0) < 4):
                continue
            key = row.get(field)
            extra = {}
            if category == "character":
                characters[row["Id"]] = clean(maps["en"].get(key, ""))
            if category == "skill" and characters.get(row.get("SkillGroupId")):
                extra["character"] = characters[row["SkillGroupId"]]
            add(entries, "Wuthering Waves", category, maps["en"].get(key), maps["zh-Hans"].get(key), **extra)
    wanted = {"Resonator", "Echo", "Forte Circuit", "Resonance Skill", "Resonance Liberation", "Intro Skill", "Outro Skill",
              "Resonance Chain", "Waveband", "Union Level", "SOL3 Phase", "Tacet Discord", "Tacet Field", "Convene",
              "Huanglong", "Jinzhou", "Rinascita", "Septimont", "Black Shores", "Lahai-Roi", "Spectro", "Havoc", "Glacio", "Fusion", "Electro", "Aero"}
    # Some UI labels share an English value but append "priority" in Chinese.
    # Prefer the shortest clean identity name instead of adding those UI variants.
    for value in wanted:
        names = [clean(maps["zh-Hans"].get(key)) for key, text in maps["en"].items() if text == value]
        names = [name for name in names if name]
        if names:
            add(entries, "Wuthering Waves", "term", value, min(names, key=len))
    add(entries, "Wuthering Waves", "character", "Rover", "漂泊者", note="漂泊者各属性形态的统称。")
    add(entries, "Wuthering Waves", "chat", "signature weapon", "专武", aliases=["sig", "signature"], note="聊天简称，仅在角色配装或武器语境中使用。")
    for en, zh, aliases in [("Wuthering Waves", "鸣潮", ["WuWa", "WW"]), ("damage per second", "每秒伤害", ["DPS"]), ("critical rate", "暴击率", ["crit rate", "CR"]), ("critical damage", "暴击伤害", ["crit dmg", "CDMG"]), ("Tower of Adversity", "逆境深塔", ["ToA"])]:
        add(entries, "Wuthering Waves", "chat", en, zh, aliases=aliases, note="通用聊天简称；请结合上下文判断。")
    return entries, [{"url": f"https://github.com/{repo}/tree/{sha}", "snapshot": "Global release 3.7 / resource 3.7.8", "commit": sha}]


def ak_glossary():
    cn_repo, en_repo = "Kengxxiao/ArknightsGameData", "Kengxxiao/ArknightsGameData_YoStar"
    cn_sha, _ = snapshot(cn_repo, "master")
    en_sha, _ = snapshot(en_repo, "main")
    def table(repo, sha, locale, name):
        return raw(repo, sha, f"{locale}/gamedata/excel/{name}.json")
    entries = []
    cn_chars = table(cn_repo, cn_sha, "zh_CN", "character_table")
    en_chars = table(en_repo, en_sha, "en_US", "character_table")
    for key, row in cn_chars.items():
        if not key.startswith("char_") or row.get("isNotObtainable"):
            continue
        en = en_chars.get(key, {}).get("name") or row.get("appellation")
        extra = {} if key in en_chars else {"note": "英文名取自国服 appellation 字段；该英文服快照未匹配到此干员。"}
        add(entries, "Arknights", "character", en, row.get("name"), **extra)
    cn_skills = table(cn_repo, cn_sha, "zh_CN", "skill_table")
    en_skills = table(en_repo, en_sha, "en_US", "skill_table")
    owners = {}
    for char in cn_chars.values():
        for skill in char.get("skills", []):
            owners.setdefault(skill.get("skillId"), char.get("appellation", ""))
    for key, row in cn_skills.items():
        if key not in en_skills or not row.get("levels") or not en_skills[key].get("levels"):
            continue
        add(entries, "Arknights", "skill", en_skills[key]["levels"][0].get("name"), row["levels"][0].get("name"), character=owners.get(key, ""))
    cn_items = table(cn_repo, cn_sha, "zh_CN", "item_table")["items"]
    en_items = table(en_repo, en_sha, "en_US", "item_table")["items"]
    for key, row in cn_items.items():
        if key in en_items:
            add(entries, "Arknights", "resource", en_items[key].get("name"), row.get("name"))
    common = [("Arknights", "明日方舟", ["AK"]), ("skill points", "技力", ["SP"]), ("deployment points", "部署费用", ["DP"]),
              ("Elite 2", "精英二", ["E2"]), ("Elite 1", "精英一", ["E1"]), ("Skill 1", "一技能", ["S1"]),
              ("Skill 2", "二技能", ["S2"]), ("Skill 3", "三技能", ["S3"]), ("Mastery 3", "专精三", ["M3"]),
              ("Rhodes Island", "罗德岛", ["RI"]), ("Operator", "干员", []), ("Guard", "近卫", []), ("Vanguard", "先锋", []),
              ("Defender", "重装", []), ("Sniper", "狙击", []), ("Caster", "术师", []), ("Medic", "医疗", []),
              ("Supporter", "辅助", []), ("Specialist", "特种", [])]
    for en, zh, aliases in common:
        add(entries, "Arknights", "chat", en, zh, aliases=aliases, note="游戏类别或常见聊天简称；普通词义须结合上下文判断。")
    return entries, [{"url": f"https://github.com/{cn_repo}/tree/{cn_sha}", "commit": cn_sha}, {"url": f"https://github.com/{en_repo}/tree/{en_sha}", "commit": en_sha, "note": "国服和英文服更新进度不同；技能、资源仅对齐双方存在的条目。"}]


def endfield_glossary():
    base = "https://endfield-assets.fffdan.com"
    entries, sources = [], []
    characters = {}
    for table, category in [("CharGrowthTable", "character"), ("ItemTable", "resource"), ("SpaceshipSkillTable", "skill"), ("GeneralAbilityTable", "skill"), ("CharProfessionTable", "term"), ("CharTypeTable", "term")]:
        url = f"{base}/table/{table}/all"
        data = get_json(url)
        locales = {lang: get_json(f"{base}/i18n/dict/{lang}/table/{table}/all") for lang in ["CN", "EN"]}
        sources.append({"url": url, "capturedAt": datetime.datetime.fromtimestamp((CACHE / hashlib.sha256(url.encode()).hexdigest()).stat().st_mtime, datetime.timezone.utc).date().isoformat(), "sha256": hashlib.sha256(download(url)).hexdigest()})
        def pair(value):
            key = str(value.get("id", "")) if isinstance(value, dict) else ""
            return locales["EN"].get(key), locales["CN"].get(key)
        for key, row in data.items():
            if not isinstance(row, dict):
                continue
            en, zh = pair(row.get("name", row))
            add(entries, "Arknights: Endfield", category, en, zh)
            if table == "CharGrowthTable":
                characters[key] = clean(en)
                # Only short name fields, never descriptions, dialogue, or biography.
                def names(node):
                    if isinstance(node, dict):
                        for field, value in node.items():
                            if field.lower() in ["name", "skillname", "talentname", "talentnamepostfix"] and isinstance(value, dict):
                                en, zh = pair(value)
                                add(entries, "Arknights: Endfield", "skill", en, zh, character=characters[key])
                            elif isinstance(value, (dict, list)):
                                names(value)
                    elif isinstance(node, list):
                        for value in node:
                            names(value)
                for field in ["skillGroupMap", "talentNodeMap", "talentNodeList", "potentialMap"]:
                    names(row.get(field, {}))
    for en, zh, aliases in [("Arknights: Endfield", "明日方舟：终末地", ["Endfield", "AKE"]), ("Endministrator", "管理员", ["Endmin"]), ("Automated Industry Complex", "集成工业系统", ["AIC"])]:
        add(entries, "Arknights: Endfield", "chat", en, zh, aliases=aliases, note="常见简称；需要结合终末地语境。")
    return entries, sources


def write_glossary(filename, name, patterns, entries, sources):
    unique = {}
    for row in entries:
        key = (row["game"], row["category"], row["en"].lower(), row["zh"], row.get("character", ""))
        unique[key] = row
    entries = sorted(unique.values(), key=lambda row: (row["game"], ["character", "skill", "resource", "weapon", "term", "chat"].index(row["category"]), row["en"].lower()))
    result = {"version": 1, "name": name, "updatedAt": GENERATED_AT, "areaNames": patterns,
              "editingGuide": "可直接增加 entries 条目：en/zh 必填，game/category 可选分类，aliases 是可选简称数组，character/note 可选。不支持注释或末尾多余逗号。",
              "sources": sources, "entries": entries}
    target = ROOT / "glossaries" / "generated" / filename
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    current = target.parent.parent / filename
    if not current.exists():
        current.write_bytes(target.read_bytes())
    print(filename, len(entries), dict(collections.Counter((row["game"], row["category"]) for row in entries)), flush=True)


def build():
    ww, ww_sources = ww_glossary()
    write_glossary("wuthering-waves.json", "Wuthering Waves（鸣潮）", ["Wuthering Waves", "鸣潮", "WuWa"], ww, ww_sources)
    ak, ak_sources = ak_glossary()
    end, end_sources = endfield_glossary()
    write_glossary("arknights-endfield.json", "Arknights + Endfield（明日方舟＋终末地）", ["Arknights + AK Endfield", "AK+Endfield", "明日方舟"], ak + end, ak_sources + end_sources)


def inspect():
    repo = "Arikatsu/WutheringWaves_Data"
    sha, paths = snapshot(repo, "3.7")
    names = {"roleinfo.json", "iteminfo.json", "skill.json", "skilldescription.json", "weaponconf.json", "elementinfo.json", "roleskilltreedesc.json", "phantominfo.json"}
    selected = [path for path in paths if path.startswith("Textmaps/en/") and pathlib.Path(path).name.lower() in names]
    print("WW", sha, selected)
    print("WW locale", [p for p in paths if p.startswith("Textmaps/") and p.endswith("RoleInfo.json")])
    print("WW texts", raw(repo, sha, selected[2])[:4])
    bundle = zipfile.ZipFile(io.BytesIO(download("https://github.com/3aKHP/EndFieldGameData/releases/download/v0.2.0/endfield-tables.zip")))
    print("END EN sample", list(json.loads(bundle.read("i18n/EN.json")).items())[:3])
    for path in bundle.namelist():
        if pathlib.Path(path).name in ["CharacterTable.json", "ItemTable.json", "SkillTable.json"]:
            data = json.loads(bundle.read(path))
            row = next(iter(data.values()))
            print("END", path, "keys", list(row))
            print("END", path, "sample", json.dumps({k: v for k, v in row.items() if any(s in k.lower() for s in ["name", "skill", "talent", "potential", "id"])}, ensure_ascii=False)[:7500])


if __name__ == "__main__":
    inspect() if "--inspect" in sys.argv else build()
