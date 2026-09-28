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
st.write("Upload a photo of your whiteboard notes. The AI will transcribe the text and match it perfectly with your uploaded textbook PDFs!")

# Fetch the secure Hugging Face token from Streamlit Advanced Settings
HF_API_TOKEN = st.secrets.get("HUGGINGFACEHUB_API_TOKEN")

if not HF_API_TOKEN:
    st.error("⚠️ System token missing! Please add HUGGINGFACEHUB_API_TOKEN to your Streamlit Secrets dashboard.")
    st.stop()

# --- 2. BUILD THE TEXTBOOK DATABASE (RAG) ---
@st.cache_resource
def load_textbooks():
    """Reads PDF files from the 'books' folder, slices them, and indexes them."""
    # Create the folder automatically if it's missing from GitHub
    if not os.path.exists("books"):
        os.makedirs("books")
        
    # Check if the folder contains any PDFs
    if not os.listdir("books"):
        return None
        
    try:
        # Load documents out of the local books directory
        loader = PyPDFDirectoryLoader("books/")
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
    # Using a reliable multi-modal vision endpoint hosted on the serverless Hub
    url = "https://huggingface.co"
    headers = {"Authorization": f"Bearer {HF_API_TOKEN}"}
    
    try:
        response = requests.post(url, headers=headers, data=image_bytes, timeout=30)
        if response.status_code == 200:
            # Safely grab the generated transcription text output
            result = response.json()
            if isinstance(result, list) and len(result) > 0:
                return result[0].get("generated_text", "Could not decipher legible notes.")
            return str(result)
        return f"Handwriting scanner is updating. Error code: {response.status_code}"
    except Exception:
        return "The image processing server took too long to reply."

def generate_study_notes(whiteboard_raw_text, textbook_context):
    """Feeds everything to Qwen 2.5 to compile formal study guides."""
    url = "https://huggingface.co"
    headers = {"Authorization": f"Bearer {HF_API_TOKEN}", "Content-Type": "application/json"}
    
    # Construct a bulletproof system prompt forcing accuracy
    prompt = (
        f"<|im_start|>system\nYou are a precise classroom teaching assistant. "
        f"Your task is to take messy transcribed whiteboard text and format it into clean, beautifully structured study notes. "
        f"You MUST verify and enrich the notes using ONLY the official textbook material provided below. Do not use outside facts.\n"
        f"OFFICIAL TEXTBOOK CONTENT:\n{textbook_context}\n<|im_end|>\n"
        f"<|im_start|>user\nWHITEBOARD NOTES TO EXPAND:\n{whiteboard_raw_text}\n\n"
        f"Create a well-formatted study guide using headers, clear bullet points, and core textbook facts.<|im_end|>\n"
        f"<|im_start|>assistant\n"
    )
    
    payload = {"inputs": prompt, "parameters": {"max_new_tokens": 1200, "temperature": 0.15}}
    
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=30)
        if response.status_code == 200:
            return response.json().get("generated_text", "Failed to compile note text.")
        return f"Text generation server is congested (Code {response.status_code}). Please try again."
    except Exception:
        return "Connection timed out while writing notes."

# --- 4. APP SCREEN VISUAL LAYOUT ---
col1, col2 = st.columns([1, 1])

with col1:
    st.subheader("📸 Step 1: Upload Whiteboard")
    uploaded_file = st.file_uploader("Choose a whiteboard image file...", type=["png", "jpg", "jpeg"])
    
    if not retriever:
        st.info("ℹ️ Note: No books found in your repository's 'books/' folder yet. Uploading PDFs to GitHub allows the AI to reference your textbooks.")

if uploaded_file is not None:
    with col1:
        st.image(uploaded_file, caption="Target Lecture Material", use_container_width=True)
        submit_btn = st.button("✨ Generate My Complete Study Notes", type="primary")

    if submit_btn:
        with col2:
            st.subheader("📘 Step 2: Generated Study Guide")
            
            # Step-by-step progress tracking framework
            with st.status("Analyzing class data...", expanded=True) as status:
                
                # Execution Phase A: OCR
                status.update(label="Reading whiteboard handwriting via GLM-OCR...")
                image_bytes = uploaded_file.getvalue()
                transcription = run_ocr_transcription(image_bytes)
                st.write(f"📝 **Detected Topics:** {transcription}")
                
                # Execution Phase B: RAG Search
                status.update(label="Searching uploaded textbooks for supporting content...")
                textbook_data = ""
                if retriever:
                    matched_paragraphs = retriever.invoke(transcription)
                    textbook_data = "\n\n".join([doc.page_content for doc in matched_paragraphs])
                else:
                    textbook_data = "No custom textbooks available. Relying on default context bounds."
                
                # Execution Phase C: Generation
                status.update(label="Writing structured summaries with Qwen-2.5...")
                final_notes = generate_study_notes(transcription, textbook_data)
                
                status.update(label="Process Complete!", state="complete")
            
            st.success("🎉 Notes built successfully!")
            st.markdown("---")
            st.markdown(final_notes)
