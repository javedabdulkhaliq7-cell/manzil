import os
import streamlit as st
from huggingface_hub import InferenceClient
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

# Initialize the official Hugging Face Inference client
@st.cache_resource
def get_inference_client():
    return InferenceClient(token=HF_API_TOKEN)

client = get_inference_client()

# --- 2. BUILD THE TEXTBOOK DATABASE (RAG) ---
@st.cache_resource
def load_textbooks():
    """Reads PDF files from the 'textbooks' folder, slices them, and indexes them."""
    if not os.path.exists("textbooks"):
        os.makedirs("textbooks")
        
    if not os.listdir("textbooks"):
        return None
        
    try:
        loader = PyPDFDirectoryLoader("textbooks/")
        docs = loader.load()
        
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=700, chunk_overlap=100)
        chunks = text_splitter.split_documents(docs)
        
        embeddings = HuggingFaceEmbeddings(model_name="BAAI/bge-small-en-v1.5")
        vector_db = FAISS.from_documents(chunks, embeddings)
        return vector_db.as_retriever(search_kwargs={"k": 3})
    except Exception as e:
        st.warning(f"Error loading your PDF textbooks: {e}")
        return None

# Start the textbook processing engine
retriever = load_textbooks()

# --- 3. CONNECT TO HUGGING FACE AI VIA INFERENCE CLIENT ---
def run_ocr_transcription(image_bytes):
    """Sends the whiteboard image to the serverless vision endpoint using InferenceClient."""
    try:
        # Utilizing the official client helper to process the binary image stream
        response = client.image_to_text(
            image=image_bytes,
            model="Salesforce/blip2-opt-2.7b"
        )
        return response.strip() if response else "Could not decipher legible notes."
    except Exception as e:
        return f"The image processing server failed: {str(e)}"

def generate_study_notes(user_query, textbook_context, mode="whiteboard"):
    """Feeds text and textbook snippets to Llama 3.1 8B using InferenceClient."""
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

    messages = [
        {"role": "system", "content": f"{system_instructions}\n\nOFFICIAL TEXTBOOK CONTENT:\n{textbook_context}"},
        {"role": "user", "content": user_prompt}
    ]
    
    try:
        # Utilizing the universally supported, free-tier Llama 3.1 8B Instruct model
        completion = client.chat_completion(
            model="meta-llama/Llama-3.1-8B-Instruct",
            messages=messages,
            max_tokens=1200,
            temperature=0.15
        )
        return completion.choices[0].message.content
    except Exception as e:
        return f"The server failed to compile a response: {str(e)}"

# --- 4. APP SCREEN VISUAL LAYOUT ---
col1, col2 = st.columns(2)

# Initialize execution flags
trigger_whiteboard = False
trigger_text = False

with col1:
    st.subheader("📸 Option A: Upload Whiteboard")
    uploaded_file = st.file_uploader("Choose a whiteboard image file...", type=["png", "jpg", "jpeg"])
    if uploaded_file is not None:
        st.image(uploaded_file, caption="Target Lecture Material", use_container_width=True)
        if st.button("✨ Generate My Complete Study Notes", type="primary"):
            trigger_whiteboard = True
            
    st.markdown("---")
    
    st.subheader("💬 Option B: Ask a Question directly")
    custom_question = st.text_input("Type your question from the textbook here:", placeholder="e.g., What is Ideology?")
    if st.button("❓ Ask AI Now"):
        if custom_question.strip() != "":
            trigger_text = True
        else:
            st.warning("Please type a question first!")

    if not retriever:
        st.info("ℹ️ Note: No books found in your repository's 'textbooks/' folder yet.")

# --- 5. CLEAN INDEPENDENT EXECUTION LOGIC ---
with col2:
    st.subheader("📘 AI Response & Study Guide")

    # Execution 1: Image Processing
    if trigger_whiteboard and uploaded_file is not None:
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
                textbook_data = "No custom textbooks available."
            
            status.update(label="Writing structured summaries with Llama-3.1...")
            final_notes = generate_study_notes(transcription, textbook_data, mode="whiteboard")
            status.update(label="Process Complete!", state="complete")
        
        st.success("🎉 Notes built successfully!")
        st.markdown(final_notes)

    # Execution 2: Direct Text Query Processing
    elif trigger_text:
        with st.status("Processing your question...", expanded=True) as status:
            status.update(label="Searching uploaded textbooks for answers...")
            textbook_data = ""
            if retriever:
                matched_paragraphs = retriever.invoke(custom_question)
                textbook_data = "\n\n".join([doc.page_content for doc in matched_paragraphs])
            else:
                textbook_data = "No custom textbooks available."
            
            status.update(label="Consulting Llama-3.1 for context verification...")
            answer = generate_study_notes(custom_question, textbook_data, mode="text_query")
            status.update(label="Answer Ready!", state="complete")
            
        st.success("🎉 Answer generated from textbook:")
        st.markdown(answer)
