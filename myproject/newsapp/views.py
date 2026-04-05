from django.shortcuts import render
from django.http import HttpResponse
from django.views import View 
# Create your views here.

def hello_word(request):
    return HttpResponse("Hello world")

def homepage(request):
    return render(request, 'index.html')