from fastapi import FastAPI

app = FastAPI()

def print_hi():
    return "HI"
@app.get("/note")
def read_root():
    return print_hi()