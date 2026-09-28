import os
import streamlit as st
import requests
from langchain_community.document_loaders import PyPDFDirectoryLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain_community.vectorstores import FAISS
from langchain_huggingface import HuggingFaceEmbeddings

# --- 1. SET UP THE APP INTERFACE ---
st.set_page_config(page_title="Whiteboard Study Assistant", page_icon="📝", layout="wide")
st.title("📝 Whiteboard to Textbook Study Guide Wizard")
st.write("Upload a photo of your whiteboard notes or type a custom question. The AI will answer and match it perfectly with your uploaded textbook PDFs!")

# Fetch the secure Hugging Face token from Streamlit Advanced Settings
HF_API_TOKEN = st.secrets.get("HUGGINGFACEHUB_API_TOKEN")

if not HF_API_TOKEN:
    st.error("⚠️ System token missing! Please add HUGGINGFACEHUB_API_TOKEN to your Streamlit Secrets dashboard.")
    st.stop()

# --- 2. BUILD THE TEXTBOOK DATABASE (RAG) ---
@st.cache_resource
def load_textbooks():
    """Reads PDF files from the 'textbooks' folder, slices them, and indexes them."""
    # Create the folder automatically if it's missing from GitHub
    if not os.path.exists("textbooks"):
        os.makedirs("textbooks")
        
    # Check if the folder contains any PDFs
    if not os.listdir("textbooks"):
        return None
        
    try:
        # Load documents out of the local textbooks directory
        loader = PyPDFDirectoryLoader("textbooks/")
        docs = loader.load()
        
        # Split text into bite-sized 700 character chunks
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=700, chunk_overlap=100)
        chunks = text_splitter.split_documents(docs)
        
        # Transform paragraphs into mathematical vectors using a free Hugging Face embedding model
        embeddings = HuggingFaceEmbeddings(model_name="BAAI/bge-small-en-v1.5")
        vector_db = FAISS.from_documents(chunks, embeddings)
        return vector_db.as_retriever(search_kwargs={"k": 3})
    except Exception as e:
        st.warning(f"Error loading your PDF textbooks: {e}")
        return None

# Start the textbook processing engine
retriever = load_textbooks()

# --- 3. CONNECT TO HUGGING FACE AI ENDPOINTS ---
def run_ocr_transcription(image_bytes):
    """Sends the whiteboard image to the serverless vision endpoint for reading."""
    url = "https://huggingface.co"
    headers = {"Authorization": f"Bearer {HF_API_TOKEN}"}
    
    try:
        response = requests.post(url, headers=headers, data=image_bytes, timeout=30)
        if response.status_code == 200:
            result = response.json()
            if isinstance(result, list) and len(result) > 0:
                return result[0].get("generated_text", "Could not decipher legible notes.")
            elif isinstance(result, dict):
                return result.get("generated_text", "Could not decipher legible notes.")
            return str(result)
        return f"Handwriting scanner is updating. Error code: {response.status_code}"
    except Exception:
        return "The image processing server took too long to reply."

def generate_study_notes(user_query, textbook_context, mode="whiteboard"):
    """Feeds everything to Qwen 2.5 to compile answers or formal study guides."""
    url = "https://huggingface.co"
    headers = {"Authorization": f"Bearer {HF_API_TOKEN}", "Content-Type": "application/json"}
    
    if mode == "text_query":
        system_instructions = (
            "You are a precise classroom teaching assistant. Answer the student's question accurately. "
            "You MUST ground your explanations using ONLY the official textbook material provided below. "
            "If the answer cannot be found in the textbook context, state that it is outside the course syllabus. "
            "Do not use external internet facts."
        )
        user_prompt = f"STUDENT QUESTION:\n{user_query}"
    else:
        system_instructions = (
            "You are a precise classroom teaching assistant. Take messy transcribed whiteboard text and format it into clean, "
            "beautifully structured study notes. You MUST verify and enrich the notes using ONLY the official textbook material "
            "provided below. Do not use external internet facts."
        )
        user_prompt = f"WHITEBOARD NOTES TO EXPAND:\n{user_query}\n\nCreate a well-formatted study guide using headers and bullet points."

    prompt = (
        f"<|im_start|>system\n{system_instructions}\n"
        f"OFFICIAL TEXTBOOK CONTENT:\n{textbook_context}\n<|im_end|>\n"
        f"<|im_start|>user\n{user_prompt}<|im_end|>\n"
        f"<|im_start|>assistant\n"
    )
    
    payload = {"inputs": prompt, "parameters": {"max_new_tokens": 1200, "temperature": 0.15}}
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        if response.status_code == 200:
            return response.json().get("generated_text", "Failed to compile text.")
        return f"Text generation server is congested (Code {response.status_code}). Please try again."
    except Exception:
        return "Connection timed out while writing response."

# --- 4. APP SCREEN VISUAL LAYOUT ---
col1, col2 = st.columns()

with col1:
    st.subheader("📸 Option A: Upload Whiteboard")
    uploaded_file = st.file_uploader("Choose a whiteboard image file...", type=["png", "jpg", "jpeg"])
    
    st.markdown("---")
    
    st.subheader("💬 Option B: Ask a Question directly")
    custom_question = st.text_input("Type your question from the textbook here:", placeholder="e.g., Explain the difference between Mitosis and Meiosis.")
    text_submit_btn = st.button("❓ Ask AI Now")

    if not retriever:
        st.info("ℹ️ Note: No books found in your repository's 'textbooks/' folder yet. Uploading PDFs to GitHub allows the AI to reference your textbooks.")

# --- 5. EXECUTION LOGIC ---
with col2:
    st.subheader("📘 AI Response & Study Guide")

    # Scenario 1: Image Submission
    if uploaded_file is not None:
        with col1:
            st.image(uploaded_file, caption="Target Lecture Material", use_container_width=True)
            submit_btn = st.button("✨ Generate My Complete Study Notes", type="primary")

        if submit_btn:
            with st.status("Analyzing whiteboard data...", expanded=True) as status:
                status.update(label="Reading whiteboard handwriting via GLM-OCR...")
                image_bytes = uploaded_file.getvalue()
                transcription = run_ocr_transcription(image_bytes)
                st.write(f"📝 **Detected Topics:** {transcription}")
                
                status.update(label="Searching uploaded textbooks for supporting content...")
                textbook_data = ""
                if retriever:
                    matched_paragraphs = retriever.invoke(transcription)
                    textbook_data = "\n\n".join([doc.page_content for doc in matched_paragraphs])
                else:
                    textbook_data = "No custom textbooks available. Relying on default context bounds."
                
                status.update(label="Writing structured summaries with Qwen-2.5...")
                final_notes = generate_study_notes(transcription, textbook_data, mode="whiteboard")
                status.update(label="Process Complete!", state="complete")
            
            st.success("🎉 Notes built successfully!")
            st.markdown(final_notes)

    # Scenario 2: Direct Text Question Submission
    elif text_submit_btn and custom_question.strip() != "":
        with st.status("Processing your question...", expanded=True) as status:
            status.update(label="Searching uploaded textbooks for answers...")
            textbook_data = ""
            if retriever:
                matched_paragraphs = retriever.invoke(custom_question)
                textbook_data = "\n\n".join([doc.page_content for doc in matched_paragraphs])
            else:
                textbook_data = "No custom textbooks available."
            
            status.update(label="Consulting Qwen-2.5 for context verification...")
            answer = generate_study_notes(custom_question, textbook_data, mode="text_query")
            status.update(label="Answer Ready!", state="complete")
            
        st.success("🎉 Answer generated from textbook:")
        st.markdown(answer)
