# Optional authentication handling
try:
    from auth import handle_authentication
except ImportError:
    # Fallback for test environment if auth or msal is missing
    def handle_authentication(*args, **kwargs):
        return None


# Core libraries
import os
import re
import json
# import base64
import numpy as np
# import requests
# from requests.adapters import HTTPAdapter
# from urllib3.util.retry import Retry

from Agents.architecture_agent import ArchitectureAgent
from Agents.repo_agent import RepoAgent, ValidationAgent

# Data & computation
import scipy
import pandas as pd

# LangChain
from langchain_openai import AzureChatOpenAI
from langchain_core.messages import HumanMessage

# Visualization
import networkx as nx
import matplotlib.pyplot as plt
import matplotlib.patches as patches
from io import BytesIO

# Streamlit
import streamlit as st

# Type hints
# from typing import List, Dict, Any

import logging
from datetime import datetime, timedelta

# Setup lightweight logging
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")

def log_info(msg):
    st.write(f"🟩 {msg}")
    logging.info(msg)

def log_error(msg):
    st.error(f"❌ {msg}")
    logging.error(msg)

# -----------------------------
# 1️⃣ Initialize LLM
# -----------------------------
azure_secrets = st.secrets.get("azure_llm", {
    "api_key": "",
    "api_version": "",
    "azure_deployment": "",
    "azure_endpoint": ""
})

llm = AzureChatOpenAI(
    api_key=azure_secrets.get("api_key"), 
    api_version=azure_secrets.get("api_version"),
    azure_deployment=azure_secrets.get("azure_deployment"),
    azure_endpoint=azure_secrets.get("azure_endpoint")
)

st.set_page_config(page_title="Information and Explore", layout="wide")

DOC_STRUCTURE = {
    "Frontend/UI Layer": ["Views", "Pages", "ClientApp", "wwwroot"],
    "Backend Core": ["Controllers", "Services", "Models", "Repositories", "Handlers", "Entities"],
    "Common/Utilities": ["Helpers", "Utils", "Common"],
    "Middleware & Config": ["Startup.cs", "Program.cs"],
    "Database & Data Flow": ["Migrations", "DbContext.cs"],
    "Integrations & Messaging": ["Integrations", "Messaging"],
    "Config & Environment Mgmt": ["appsettings.json", "appsettings.Development.json"],
    "Testing & QA": ["Tests"],
    "DevOps/CI-CD": [".github", "devops", "docker", "helm"]
}

# Load DevOps secrets with default fallback
DevOps_secrets = st.secrets.get("DevOps", {
    "AZURE_ORG": "your-org",
    "AZURE_PROJECT": "your-project",
    "REPO_NAME": "your-repo",
    "BRANCH": "main",
    "AZURE_PAT": None
})

# Access individual secrets safely
AZURE_ORG = DevOps_secrets.get("AZURE_ORG", "your-org")
AZURE_PROJECT = DevOps_secrets.get("AZURE_PROJECT", "your-project")
REPO_NAME = DevOps_secrets.get("REPO_NAME", "your-repo")
BRANCH = DevOps_secrets.get("BRANCH", "main")
AZURE_PAT = DevOps_secrets.get("AZURE_PAT", None)  # recommended to set in Streamlit secrets


class LLMClient:
    def __init__(self, llm):
        self.llm = llm

    def generate(self, prompt: str) -> str:
        try:
            if not self.llm:
                return "❌ LLM not configured."

            if hasattr(self.llm, "invoke"):
                result = self.llm.invoke([{"role": "user", "content": prompt}])
                return getattr(result, "content", str(result))

            elif hasattr(self.llm, "generate"):
                result = self.llm([{"role": "user", "content": prompt}])
                if hasattr(result, "generations"):
                    return result.generations[0][0].text
                return str(result)

            elif callable(self.llm):
                result = self.llm(prompt)
                return result if isinstance(result, str) else str(result)

            else:
                return "❌ Unsupported LLM interface."

        except Exception as e:
            log_error(f"LLM generation failed: {e}")
            return f"❌ Error: {e}"

# ------------------------
# UI Agent: Streamlit views & coordination
# ------------------------
class UIAgent:
    def __init__(self, repo_agent: RepoAgent, validation_agent: ValidationAgent,arch_agent: ArchitectureAgent):
        self.validation_agent = validation_agent
        self.repo_agent = repo_agent
        self.arch_agent = arch_agent

        if "selected_file" not in st.session_state:
            st.session_state.selected_file = None

        if "expanded_paths" not in st.session_state:
            st.session_state.expanded_paths = set()


    def show_structure_validation(self):
        st.header("🗂️ Repo Structure Validator")
        results = self.validation_agent.check_structure_with_count()
        for section, checks in results.items():
            with st.expander(f"📂 {section}"):
                for item in checks:
                    icon = "📁" if not item["name"].endswith((".cs", ".json", ".py")) else "📄"
                    st.write(f"{item['status']} {icon} `{item['name']}` — Count: {item['count']}")
                    for p in item['paths']:
                        st.text(f"   ↳ {p}")

    def show_architecture_insights(self):
        st.header("🏗 Architecture Insights")

        st.write("**Architecture Type:**", self.arch_agent.detect_architecture_type())        
        st.write("**High-Level Flow:**", self.arch_agent.get_high_level_architecture())

        api_count, api_files = self.arch_agent.count_apis()
        st.write("**API Count:**", api_count)

        st.write("**Auth Type:**", self.arch_agent.detect_auth_type())

        st.subheader("DTOs")
        st.write(self.arch_agent.find_dtos())

        st.subheader("API Locations")
        st.write(self.arch_agent.find_api_line_numbers()) 

        st.subheader("Request and Response Body")
        st.write(self.arch_agent.extract_request_response())


    def show_repo_browser(self):
        st.subheader("📂 Repository Browser")
        col1, col2 = st.columns([2, 3])
        with col1:
            st.markdown("### Repo Structure")
            repo_tree = self.repo_agent.get_repo_tree()
            if not repo_tree:
                st.warning("No repository data available. Please fetch/crawl first.")
                return

            if "selected_file" not in st.session_state:
                st.session_state.selected_file = None

            def render_tree(repo_agent, path="/", level=0):
                items = repo_agent.list_items(path)

                for item in items:
                    item_path = item["path"]
                    name = os.path.basename(item_path)
                    is_folder = item.get("isFolder", False)

                    indent = " " * level  # visual indentation

                    if is_folder:
                        expanded = item_path in st.session_state.expanded_paths

                        if st.button(
                            f"{indent}{'📂' if expanded else '📁'} {name}",
                            key=item_path
                        ):
                            if expanded:
                                st.session_state.expanded_paths.remove(item_path)
                            else:
                                st.session_state.expanded_paths.add(item_path)

                        if expanded:
                            render_tree(repo_agent, item_path, level + 1)

                    else:
                        if st.button(f"{indent}📄 {name}", key=item_path):
                            st.session_state.selected_file = item_path

            render_tree(self.repo_agent, "/")

        with col2:
            st.markdown("### File Preview")
            if st.session_state.selected_file:
                content = self.repo_agent.get_file_content(st.session_state.selected_file)
                if content:
                    # guess language
                    lang = "python" if st.session_state.selected_file.endswith(".py") else None
                    st.code(content, language=lang)
                else:
                    st.warning("Could not load file content.")
            else:
                st.info("👈 Select a file from the left tree to preview its content.")

    def run_app(self):
        tab1, tab2,tab3 = st.tabs([
            "🔍 Structure Validation",
            "📂 Browser",
            "🏗 Architecture Insights"
        ])
        with tab1:
            self.show_structure_validation()
        with tab2:
            self.show_repo_browser()
        with tab3:
            self.show_architecture_insights()


# ------------------------
# main
# ------------------------
def main():
    st.title("🚀 Repo Explorer & Documentation")

    if not AZURE_PAT:
        st.warning("AZURE_PAT not configured. Set AZURE_PAT in Streamlit secrets to enable Azure DevOps calls.")
        # still allow UI to run with empty repo agent
    repo_agent = RepoAgent(AZURE_ORG, AZURE_PROJECT, REPO_NAME, BRANCH, AZURE_PAT)
    validation_agent = ValidationAgent(repo_agent, DOC_STRUCTURE)
    arch_agent = ArchitectureAgent(repo_agent)


    # LLM: you can pass your AzureChatOpenAI/other llm object here. Keep None if not configured.

    ui_agent = UIAgent(repo_agent, validation_agent, arch_agent)


    # initial fetch button
    if st.button("Fetch repo items (Azure DevOps)"):
        with st.spinner("Fetching..."):
            repo_agent.fetch_all_items()
            repo_agent.build_tree()
            arch_agent.load_items()
        st.success("Fetched repository items (cached).")

    ui_agent.run_app()


if __name__ == "__main__":
    main()
